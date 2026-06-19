import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationCampaign, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Paginated, paginated } from '../common/pagination';
import { AudienceService } from './audience.service';
import { AudienceSpec } from './audience.types';
import { CampaignDispatchService } from './campaign-dispatch.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { DispatchCampaignDto } from './dto/dispatch-campaign.dto';

// Statuses that still allow editing / scheduling (not yet sending or done).
const EDITABLE = ['DRAFT', 'SCHEDULED'];

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audience: AudienceService,
    private readonly dispatch: CampaignDispatchService,
  ) {}

  async list(page: number, pageSize: number): Promise<Paginated<NotificationCampaign>> {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.notificationCampaign.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notificationCampaign.count(),
    ]);
    return paginated(data, total, page, pageSize);
  }

  async getOne(id: string): Promise<NotificationCampaign> {
    const camp = await this.prisma.notificationCampaign.findUnique({ where: { id } });
    if (!camp) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Campanha não encontrada.' });
    return camp;
  }

  /** Live audience size for the wizard. */
  previewCount(spec: AudienceSpec): Promise<number> {
    return this.audience.count(spec);
  }

  async create(dto: CreateCampaignDto, adminId: string): Promise<NotificationCampaign> {
    const sendAt = dto.sendAt ? new Date(dto.sendAt) : null;
    const camp = await this.prisma.notificationCampaign.create({
      data: {
        title: dto.title.trim(),
        body: dto.body.trim(),
        url: dto.url?.trim() || null,
        channels: dto.channels,
        audienceAll: dto.audienceAll,
        filter: dto.audienceAll ? Prisma.DbNull : ((dto.filter ?? null) as Prisma.InputJsonValue),
        sendAt,
        status: sendAt ? 'SCHEDULED' : 'DRAFT',
        createdById: adminId,
      },
    });
    if (sendAt && sendAt.getTime() <= Date.now()) this.dispatch.kick(camp.id);
    return camp;
  }

  async update(id: string, dto: UpdateCampaignDto): Promise<NotificationCampaign> {
    const camp = await this.getOne(id);
    this.assertEditable(camp);
    const audienceAll = dto.audienceAll ?? camp.audienceAll;
    const data: Prisma.NotificationCampaignUpdateInput = {
      ...(dto.title !== undefined && { title: dto.title.trim() }),
      ...(dto.body !== undefined && { body: dto.body.trim() }),
      ...(dto.url !== undefined && { url: dto.url.trim() || null }),
      ...(dto.channels !== undefined && { channels: dto.channels }),
      ...(dto.audienceAll !== undefined && { audienceAll }),
    };
    // Keep filter consistent with audienceAll.
    if (dto.audienceAll === true) {
      data.filter = Prisma.DbNull;
    } else if (dto.filter !== undefined) {
      data.filter = (dto.filter ?? Prisma.DbNull) as Prisma.InputJsonValue;
    }
    return this.prisma.notificationCampaign.update({ where: { id }, data });
  }

  /** Finalize the dispatch: send now (no sendAt) or schedule (future sendAt). */
  async dispatchCampaign(id: string, dto: DispatchCampaignDto): Promise<NotificationCampaign> {
    const camp = await this.getOne(id);
    this.assertEditable(camp);
    const sendAt = dto.sendAt ? new Date(dto.sendAt) : new Date();
    const updated = await this.prisma.notificationCampaign.update({
      where: { id },
      data: { sendAt, status: 'SCHEDULED' },
    });
    if (sendAt.getTime() <= Date.now()) this.dispatch.kick(id);
    return updated;
  }

  async cancel(id: string): Promise<NotificationCampaign> {
    const camp = await this.getOne(id);
    if (!EDITABLE.includes(camp.status)) {
      throw new BadRequestException({ code: 'INVALID_STATE', message: 'Só dá para cancelar rascunho ou agendamento.' });
    }
    return this.prisma.notificationCampaign.update({ where: { id }, data: { status: 'CANCELLED', sendAt: null } });
  }

  async remove(id: string): Promise<void> {
    const camp = await this.getOne(id);
    if (camp.status === 'SENDING') {
      throw new BadRequestException({ code: 'INVALID_STATE', message: 'A campanha está sendo enviada.' });
    }
    await this.prisma.notificationCampaign.delete({ where: { id } });
  }

  private assertEditable(camp: NotificationCampaign): void {
    if (!EDITABLE.includes(camp.status)) {
      throw new BadRequestException({
        code: 'INVALID_STATE',
        message: 'Esta campanha não pode mais ser editada.',
      });
    }
  }
}

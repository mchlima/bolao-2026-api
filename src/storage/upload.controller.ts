import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { StorageService } from './storage.service';

@Controller('admin/uploads')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class UploadController {
  constructor(private readonly storage: StorageService) {}

  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async image(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('prefix') prefix?: string,
  ): Promise<{ url: string }> {
    if (!file) {
      throw new BadRequestException({
        code: 'NO_FILE',
        message: 'Nenhum arquivo enviado.',
      });
    }
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException({
        code: 'INVALID_FILE',
        message: 'Envie uma imagem.',
      });
    }
    const safePrefix = (prefix || 'misc').replace(/[^a-z0-9-]/gi, '') || 'misc';
    const url = await this.storage.uploadImage(file.buffer, safePrefix);
    return { url };
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthResponse, AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { SafeUser } from '../users/user.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.auth.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: SafeUser): SafeUser {
    return user;
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateMe(
    @CurrentUser() user: SafeUser,
    @Body() dto: UpdateMeDto,
  ): Promise<SafeUser> {
    return this.auth.updateMe(user.id, dto);
  }

  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  uploadAvatar(
    @CurrentUser() user: SafeUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<SafeUser> {
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
    return this.auth.setAvatar(user.id, file);
  }

  @Delete('me/avatar')
  @UseGuards(JwtAuthGuard)
  removeAvatar(@CurrentUser() user: SafeUser): Promise<SafeUser> {
    return this.auth.removeAvatar(user.id);
  }
}

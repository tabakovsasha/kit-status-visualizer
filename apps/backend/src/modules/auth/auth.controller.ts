import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { ChangeFirstPasswordDto, ChangePasswordDto, LoginDto } from './dto';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setRefreshCookie(response: Response, token: string) {
    response.cookie(process.env.REFRESH_COOKIE_NAME ?? 'kit_refresh', token, {
      httpOnly: true,
      secure: (process.env.REFRESH_COOKIE_SECURE ?? 'true') === 'true',
      sameSite:
        (process.env.REFRESH_COOKIE_SAMESITE as 'lax' | 'strict' | 'none') ??
        'lax',
      path: '/api/auth',
      maxAge: 1000 * 60 * 60 * 24 * 365,
    });
  }

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(
      dto.login,
      dto.password,
      request.headers['user-agent'],
      request.ip,
    );
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('refresh')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const cookieName = process.env.REFRESH_COOKIE_NAME ?? 'kit_refresh';
    const refreshToken = request.cookies?.[cookieName];
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh cookie');
    }
    const result = await this.authService.refresh(refreshToken);
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const cookieName = process.env.REFRESH_COOKIE_NAME ?? 'kit_refresh';
    const refreshToken = request.cookies?.[cookieName];
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    response.clearCookie(cookieName, { path: '/api/auth' });
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(
    @CurrentUser()
    user: {
      userId: string;
      login: string;
      role: 'ADMIN' | 'USER';
      mustChangePassword: boolean;
    },
  ) {
    return {
      id: user.userId,
      login: user.login,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-first-password')
  async changeFirstPassword(
    @CurrentUser() user: { userId: string; mustChangePassword: boolean },
    @Body() dto: ChangeFirstPasswordDto,
  ) {
    if (!user.mustChangePassword) {
      throw new ForbiddenException('First password change is not required');
    }
    if (dto.newPassword !== dto.confirmPassword) {
      throw new ForbiddenException('Password confirmation does not match');
    }

    const updated = await this.authService.changeFirstPassword(
      user.userId,
      dto.newPassword,
    );

    return {
      success: true,
      user: {
        id: updated.id,
        login: updated.login,
        role: updated.role,
        isActive: updated.isActive,
        mustChangePassword: updated.mustChangePassword,
      },
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(
    @CurrentUser() user: { userId: string },
    @Body() dto: ChangePasswordDto,
  ) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new ForbiddenException('Password confirmation does not match');
    }

    return this.authService.changePassword(
      user.userId,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('revoke-all')
  async revokeAll(@CurrentUser() user: { userId: string }) {
    await this.authService.revokeAllSessions(user.userId);
    return { success: true };
  }
}

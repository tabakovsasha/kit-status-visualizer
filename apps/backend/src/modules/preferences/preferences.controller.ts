import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import { PreferencesService } from './preferences.service';

@Controller('api/preferences')
@UseGuards(JwtAuthGuard)
export class PreferencesController {
  constructor(private readonly service: PreferencesService) {}

  @Get()
  get(@CurrentUser() user: { userId: string }) {
    return this.service.get(user.userId);
  }

  @Put()
  put(
    @CurrentUser() user: { userId: string },
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.put(user.userId, body);
  }
}

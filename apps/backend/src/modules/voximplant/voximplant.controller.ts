import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import { TestCredentialsDto, UpsertCredentialsDto } from './dto';
import { VoximplantService } from './voximplant.service';

@Controller('api/voximplant')
@UseGuards(JwtAuthGuard)
export class VoximplantController {
  constructor(private readonly service: VoximplantService) {}

  @Get('credentials')
  async getCredentials(@CurrentUser() user: { userId: string }) {
    return this.service.getCredentials(user.userId);
  }

  @Put('credentials')
  async putCredentials(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpsertCredentialsDto,
  ) {
    await this.service.upsertCredentials(
      user.userId,
      dto.domain,
      dto.host,
      dto.access_token || undefined,
    );
    return this.service.getCredentials(user.userId);
  }

  @Put('credentials/test')
  async testCredentials(
    @CurrentUser() user: { userId: string },
    @Body() dto: TestCredentialsDto,
  ) {
    return this.service.testAndPersist(
      user.userId,
      dto.domain,
      dto.host,
      dto.access_token,
    );
  }
}

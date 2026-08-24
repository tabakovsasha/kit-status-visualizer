import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import { TimelineService } from './timeline.service';
import { TimelineQueryDto } from './dto';

@Controller('api/timelines')
@UseGuards(JwtAuthGuard)
export class TimelineController {
  constructor(private readonly service: TimelineService) {}

  @Post('query')
  query(
    @CurrentUser() user: { userId: string },
    @Body() dto: TimelineQueryDto,
  ) {
    return this.service.query(user.userId, dto);
  }
}

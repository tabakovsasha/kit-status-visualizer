import { Module } from '@nestjs/common';
import { TimelineController } from './timeline.controller';
import { TimelineService } from './timeline.service';
import { VoximplantModule } from '../voximplant/voximplant.module';

@Module({
  imports: [VoximplantModule],
  controllers: [TimelineController],
  providers: [TimelineService],
})
export class TimelineModule {}

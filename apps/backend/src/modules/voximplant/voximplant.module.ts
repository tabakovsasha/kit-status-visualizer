import { Module } from '@nestjs/common';
import { VoximplantController } from './voximplant.controller';
import { VoximplantService } from './voximplant.service';
import { VoximplantApiService } from './voximplant-api.service';

@Module({
  controllers: [VoximplantController],
  providers: [VoximplantService, VoximplantApiService],
  exports: [VoximplantService, VoximplantApiService],
})
export class VoximplantModule {}

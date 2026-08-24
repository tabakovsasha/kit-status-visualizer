import { Module } from '@nestjs/common';
import { OperatorSelectionsController } from './operator-selections.controller';
import { OperatorSelectionsService } from './operator-selections.service';

@Module({
  controllers: [OperatorSelectionsController],
  providers: [OperatorSelectionsService],
})
export class OperatorSelectionsModule {}

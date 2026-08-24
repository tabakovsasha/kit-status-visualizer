import {
  IsArray,
  IsDateString,
  IsInt,
  IsString,
  ValidateIf,
} from 'class-validator';

export class TimelineQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsArray()
  @IsInt({ each: true })
  operatorIds!: number[];

  @ValidateIf((v) => !!v.queueId)
  @IsInt()
  queueId?: number;

  @IsString()
  timezone!: string;
}

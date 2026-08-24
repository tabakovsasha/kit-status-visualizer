import { IsNotEmpty, IsString } from 'class-validator';

export class UpsertCredentialsDto {
  @IsString()
  @IsNotEmpty()
  domain!: string;

  @IsString()
  @IsNotEmpty()
  host!: string;

  @IsString()
  access_token!: string;
}

export class TestCredentialsDto {
  @IsString()
  @IsNotEmpty()
  domain!: string;

  @IsString()
  @IsNotEmpty()
  host!: string;

  @IsString()
  access_token?: string;
}

import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  login!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export class ChangeFirstPasswordDto {
  @IsString()
  @MinLength(8)
  newPassword!: string;

  @IsString()
  @MinLength(8)
  confirmPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;

  @IsString()
  @MinLength(8)
  confirmPassword!: string;
}

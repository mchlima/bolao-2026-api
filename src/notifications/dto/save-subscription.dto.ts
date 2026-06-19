import { Type } from 'class-transformer';
import { IsObject, IsString, ValidateNested } from 'class-validator';

class PushKeysDto {
  @IsString()
  p256dh!: string;

  @IsString()
  auth!: string;
}

export class SaveSubscriptionDto {
  @IsString()
  endpoint!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;
}

export class RemoveSubscriptionDto {
  @IsString()
  endpoint!: string;
}

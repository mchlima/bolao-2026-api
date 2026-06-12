import { IsString } from 'class-validator';

export class TransferOwnershipDto {
  // The member who becomes the new OWNER (must already be a member).
  @IsString()
  userId!: string;
}

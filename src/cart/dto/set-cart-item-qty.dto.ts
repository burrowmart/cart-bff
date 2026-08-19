import type { SetCartItemQtyRequest } from '@demo/contracts';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class SetCartItemQtyDto implements SetCartItemQtyRequest {
  @IsInt()
  @Min(0)
  @ApiProperty({ example: 2, minimum: 0, description: 'Absolute quantity; 0 removes the line item' })
  qty!: number;
}

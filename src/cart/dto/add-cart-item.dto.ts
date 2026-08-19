import type { AddCartItemRequest } from '@demo/contracts';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

export class AddCartItemDto implements AddCartItemRequest {
  @IsString()
  @ApiProperty({ example: 'sku-123', description: 'Catalog item id' })
  sku!: string;

  @IsInt()
  @Min(1)
  @ApiProperty({ example: 1, minimum: 1, description: 'Amount to increment the line by' })
  qty!: number;
}

import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const SKIP_KITCHEN_DESCRIPTION =
  'Restaurant only: lines from this category are served from the counter and never sent ' +
  'to the kitchen. Categories named Drinks/Beverages skip it automatically.';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Electronics', description: 'Category name' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 'Electronic devices and gadgets', required: false })
  @IsOptional()
  @IsString()
  description: string;

  @ApiProperty({ example: 'image-url', required: false })
  @IsOptional()
  @IsString()
  image: string;

  @ApiProperty({
    example: 3,
    required: false,
    description: 'Menu position, lowest first. Unique per store; omitted = placed last.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  /**
   * MUST be declared: the global ValidationPipe runs with `whitelist: true`,
   * so an undeclared field is silently dropped and the switch would never save.
   */
  @ApiProperty({ example: false, required: false, description: SKIP_KITCHEN_DESCRIPTION })
  @IsOptional()
  @IsBoolean()
  skipKitchen?: boolean;
}

export class UpdateCategoryDto {
  @ApiProperty({ example: 'Electronics', required: false })
  @IsOptional()
  @IsString()
  name: string;

  @ApiProperty({ example: 'Electronic devices', required: false })
  @IsOptional()
  @IsString()
  description: string;

  @ApiProperty({ example: 'image-url', required: false })
  @IsOptional()
  @IsString()
  image: string;

  @ApiProperty({ example: 3, required: false, description: 'Menu position, lowest first. Unique per store.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiProperty({ example: false, required: false, description: SKIP_KITCHEN_DESCRIPTION })
  @IsOptional()
  @IsBoolean()
  skipKitchen?: boolean;
}

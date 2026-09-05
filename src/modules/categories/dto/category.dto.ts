import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
}

import { IsNotEmpty, IsNumber, IsOptional, IsString, Min, IsBoolean, IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProductDto {
  @ApiProperty({ example: 'Laptop', description: 'Product name' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 'High-performance laptop', description: 'Product description', required: false })
  @IsOptional()
  @IsString()
  description: string;

  @ApiProperty({ example: 999.99, description: 'Product price' })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({ example: 700.00, description: 'Product cost price', required: false })
  @IsOptional()
  @IsNumber()
  costPrice: number;
  @ApiProperty({ example: 5, description: 'Low stock alert quantity', required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  lowStockAlertQuantity: number;
  @ApiProperty({ example: 50, description: 'Stock quantity', required: false })
  @IsOptional()
  @IsNumber()
  stock: number;

  @ApiProperty({ example: 'LAP-001', description: 'SKU', required: false })
  @IsOptional()
  @IsString()
  sku: string;

  @ApiProperty({ example: '123456789', description: 'Barcode', required: false })
  @IsOptional()
  @IsString()
  barcode: string;

  @ApiProperty({ example: 'image-url', description: 'Product image URL', required: false })
  @IsOptional()
  @IsString()
  image: string;

  @ApiProperty({ example: 'uuid', description: 'Category ID' })
  @IsNotEmpty()
  @IsString()
  categoryId: string;

  @ApiProperty({
    example: 12,
    required: false,
    description: 'Till position, lowest first. Unique per store; omitted = placed last.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateProductDto {
  @ApiProperty({ example: 'Laptop', description: 'Product name', required: false })
  @IsOptional()
  @IsString()
  name: string;

  @ApiProperty({ example: 'High-performance laptop', description: 'Product description', required: false })
  @IsOptional()
  @IsString()
  description: string;

  @ApiProperty({ example: 999.99, description: 'Product price', required: false })
  @IsOptional()
  @IsNumber()
  price: number;

  @ApiProperty({ example: 700.00, description: 'Product cost price', required: false })
  @IsOptional()
  @IsNumber()
  costPrice: number;

  @ApiProperty({ example: 50, description: 'Stock quantity', required: false })
  @IsOptional()
  @IsNumber()
  stock: number;

  @ApiProperty({ example: 'LAP-001', description: 'SKU', required: false })
  @IsOptional()
  @IsString()
  sku: string;

  @ApiProperty({ example: '123456789', description: 'Barcode', required: false })
  @IsOptional()
  @IsString()
  barcode: string;

  @ApiProperty({ example: 'image-url', description: 'Product image URL', required: false })
  @IsOptional()
  @IsString()
  image: string;

  @ApiProperty({ example: 'uuid', description: 'Category ID', required: false })
  @IsOptional()
  @IsString()
  categoryId: string;

  @ApiProperty({ example: true, description: 'Product active status', required: false })
  @IsOptional()
  @IsBoolean()
  isActive: boolean;

  @ApiProperty({ example: 5, description: 'Low stock alert quantity', required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  lowStockAlertQuantity: number;

  @ApiProperty({ example: 12, required: false, description: 'Till position, lowest first. Unique per store.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

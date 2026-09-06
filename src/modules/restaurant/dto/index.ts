import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTableDto {
  @ApiProperty({ example: 'Table 5' })
  @IsNotEmpty()
  @IsString()
  name: string;
}

export class UpdateTableDto {
  @ApiPropertyOptional({ example: 'Patio 2' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Soft-delete flag. Tables are never hard-deleted.' })
  @IsOptional()
  isActive?: boolean;
}

export class RestaurantOrderItemDto {
  @ApiProperty()
  @IsUUID()
  productId: string;

  @ApiProperty({ example: 2 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({ example: 'No onions', description: 'Kitchen instruction for this line' })
  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * Pack this line to take away, on a `dine_out` order that is otherwise eaten
   * at the table. MUST be declared here: the global ValidationPipe runs with
   * `whitelist: true`, so an undeclared field is silently dropped and the
   * kitchen would never learn to box anything.
   */
  @ApiPropertyOptional({
    example: false,
    description: 'Pack this line to go. Only meaningful on a dine_out order.',
  })
  @IsOptional()
  @IsBoolean()
  isParcel?: boolean;
}

export class CreateRestaurantOrderDto {
  @ApiProperty({
    enum: ['dine_in', 'dine_out', 'takeaway', 'delivery'],
    description:
      'dine_out = eating in AND taking a parcel home; it occupies a table like dine_in.',
  })
  @IsIn(['dine_in', 'dine_out', 'takeaway', 'delivery'])
  orderType: 'dine_in' | 'dine_out' | 'takeaway' | 'delivery';

  @ApiPropertyOptional({
    description: 'Required for dine_in and dine_out. Ignored for takeaway/delivery.',
  })
  @IsOptional()
  @IsUUID()
  tableId?: string;

  /**
   * Nested validation is explicit here. The pre-existing CreateOrderDto omits
   * it, so item fields reach that service unchecked; this one rejects a
   * negative quantity instead of persisting it.
   */
  @ApiProperty({ type: [RestaurantOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RestaurantOrderItemDto)
  items: RestaurantOrderItemDto[];

  @ApiPropertyOptional({ description: 'Save without sending to the kitchen. Does not reserve a table.' })
  @IsOptional()
  isDraft?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerPhone?: string;

  @ApiPropertyOptional({ description: 'Required for delivery.' })
  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateDraftOrderDto {
  @ApiProperty({ type: [RestaurantOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RestaurantOrderItemDto)
  items: RestaurantOrderItemDto[];

  @ApiPropertyOptional({ description: 'Intended table. A draft never reserves it.' })
  @IsOptional()
  @IsUUID()
  tableId?: string;

  /**
   * Optimistic lock. Drafts are shared between waiters, so a stale write must
   * fail loudly rather than silently discard the other waiter's lines.
   */
  @ApiPropertyOptional({ description: 'Version the client last read. Mismatch returns 409.' })
  @IsOptional()
  @IsNumber()
  version?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class AddOrderItemsDto {
  @ApiProperty({ type: [RestaurantOrderItemDto], description: 'An additional round for a live order.' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RestaurantOrderItemDto)
  items: RestaurantOrderItemDto[];
}

/**
 * What the KITCHEN may set.
 *
 * 'completed' is deliberately absent: it means "paid and the table is free",
 * which only the cashier's settle() may do. Allowing it here let the kitchen
 * strand a table forever and book unpaid orders as revenue.
 */
export class UpdateOrderStatusDto {
  @ApiProperty({
    enum: ['preparing', 'handed_over'],
    description: 'handed_over = cooked and passed to the floor; still unpaid.',
  })
  @IsIn(['preparing', 'handed_over'])
  orderStatus: 'preparing' | 'handed_over';
}

/**
 * Printing the bill — the step BEFORE money changes hands.
 *
 * The discount is fixed here, because it is what gets printed; settling
 * afterwards charges exactly the printed figure. To change it, print again.
 */
export class PrintBillDto {
  @ApiPropertyOptional({ enum: ['amount', 'percent'] })
  @IsOptional()
  @IsIn(['amount', 'percent'])
  discountType?: 'amount' | 'percent';

  @ApiPropertyOptional({ example: 250, description: 'Raw figure: 250 for flat, 25 for 25%.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountValue?: number;

  @ApiPropertyOptional({
    example: 'Bilal',
    description: 'Required on a delivery order: who carries it. Printed on the bill.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  riderName?: string;
}

/** How a partial payment was split. Amounts, not percentages; must sum to the total. */
export class PaymentSplitDto {
  @ApiPropertyOptional({ example: 1000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cash?: number;

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  card?: number;

  @ApiPropertyOptional({ example: 150 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  online?: number;
}

/**
 * Taking the money. The bill must already have been printed, by this cashier.
 *
 * The discount fields are accepted for older clients that still settle in one
 * step; a client built for the print-then-pay flow omits them and the figure
 * fixed at print time is charged.
 */
export class SettleOrderDto {
  @ApiPropertyOptional({ enum: ['amount', 'percent'] })
  @IsOptional()
  @IsIn(['amount', 'percent'])
  discountType?: 'amount' | 'percent';

  @ApiPropertyOptional({ example: 250, description: 'Raw figure: 250 for flat, 25 for 25%.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountValue?: number;

  @ApiPropertyOptional({
    enum: ['cash', 'card', 'check', 'online', 'partial'],
    description: "'partial' = more than one method; send the amounts in `split`.",
  })
  @IsOptional()
  @IsIn(['cash', 'card', 'check', 'online', 'partial'])
  paymentMethod?: string;

  @ApiPropertyOptional({
    type: PaymentSplitDto,
    description: 'Required with paymentMethod=partial. Must add up to the printed total.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentSplitDto)
  split?: PaymentSplitDto;
}

import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OpenShiftDto {
  @ApiPropertyOptional({
    example: 2000,
    description: 'Change already in the drawer when the shift starts.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  openingFloat?: number;
}

export class CloseShiftDto {
  @ApiProperty({
    example: 45300,
    description: 'The cash the cashier physically counted in the drawer.',
  })
  @IsNumber()
  @Min(0)
  countedCash: number;

  @ApiPropertyOptional({ description: 'Explanation for a shortfall or surplus.' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ForceCloseShiftDto {
  @ApiPropertyOptional({
    description: 'Why the owner closed this shift on the cashier’s behalf.',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CollectShiftDto {
  @ApiProperty({
    example: 45300,
    description: 'What the owner actually received. May differ from countedCash.',
  })
  @IsNumber()
  @Min(0)
  collectedAmount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

/** Filters for the owner's shift list. */
export class ListShiftsQueryDto {
  @ApiPropertyOptional({ enum: ['open', 'closed', 'collected'] })
  @IsOptional()
  @IsIn(['open', 'closed', 'collected'])
  status?: 'open' | 'closed' | 'collected';

  @ApiPropertyOptional({ description: 'Restrict to one cashier.' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'ISO datetime; filters on openedAt.' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO datetime; filters on openedAt.' })
  @IsOptional()
  @IsString()
  to?: string;
}

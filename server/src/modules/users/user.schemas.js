import { z } from 'zod';

export const addressSchema = z.object({
  label: z.string().trim().max(40).optional().default('Home'),
  fullName: z.string().trim().min(2, 'Full name is required').max(80),
  phone: z
    .string()
    .trim()
    .regex(/^[+]?[0-9\s-]{10,15}$/, 'Enter a valid phone number'),
  line1: z.string().trim().min(3, 'Address line 1 is required').max(120),
  line2: z.string().trim().max(120).optional().default(''),
  city: z.string().trim().min(2, 'City is required').max(60),
  state: z.string().trim().min(2, 'State is required').max(60),
  postalCode: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, 'Enter a valid 6-digit PIN code'),
  country: z.string().trim().max(60).optional().default('India'),
  isDefault: z.boolean().optional().default(false),
});

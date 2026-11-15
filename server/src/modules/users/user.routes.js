import { Router } from 'express';
import { z } from 'zod';
import { User } from '../../models/User.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { ApiError } from '../../lib/ApiError.js';
import { ok } from '../../lib/respond.js';
import { isObjectId } from '../../lib/utils.js';
import { httpUrl, toPatchSchema } from '../../lib/validation.js';
import { addressSchema } from './user.schemas.js';

const addressPatch = toPatchSchema(addressSchema);

const router = Router();
router.use(authenticate);

const addrParam = validate({ params: z.object({ addressId: z.string().refine(isObjectId, 'Invalid address id') }) });

router.patch(
  '/me',
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(80).optional(),
      phone: z
        .string()
        .trim()
        .regex(/^([+]?[0-9\s-]{10,15})?$/, 'Enter a valid phone number')
        .optional(),
      avatarUrl: z.union([httpUrl('Avatar must be an http(s) URL'), z.literal('')]).optional(),
    }),
  }),
  async (req, res) => {
    const user = await User.findByIdAndUpdate(req.user.id, { $set: req.body }, { new: true, runValidators: true });
    ok(res, { user: user.toPublic() });
  },
);

router.get('/me/addresses', async (req, res) => {
  const user = await User.findById(req.user.id, 'addresses').lean();
  ok(res, user?.addresses || []);
});

async function normaliseDefault(user, preferredId) {
  if (!user.addresses.length) return;
  const target = preferredId ? user.addresses.id(preferredId) : user.addresses.find((a) => a.isDefault) || user.addresses[0];
  user.addresses.forEach((a) => (a.isDefault = String(a._id) === String(target._id)));
}

router.post('/me/addresses', validate({ body: addressSchema }), async (req, res) => {
  const user = await User.findById(req.user.id, 'addresses');
  if (user.addresses.length >= 10) throw ApiError.badRequest('You can save up to 10 addresses');
  user.addresses.push(req.body);
  const created = user.addresses[user.addresses.length - 1];
  await normaliseDefault(user, req.body.isDefault || user.addresses.length === 1 ? created._id : null);
  await user.save();
  ok(res, user.addresses, 201);
});

router.patch('/me/addresses/:addressId', addrParam, validate({ body: addressPatch }), async (req, res) => {
  const user = await User.findById(req.user.id, 'addresses');
  const address = user.addresses.id(req.valid.params.addressId);
  if (!address) throw ApiError.notFound('Address not found');
  address.set(req.body);
  await normaliseDefault(user, req.body.isDefault ? address._id : null);
  await user.save();
  ok(res, user.addresses);
});

router.delete('/me/addresses/:addressId', addrParam, async (req, res) => {
  const user = await User.findById(req.user.id, 'addresses');
  const address = user.addresses.id(req.valid.params.addressId);
  if (!address) throw ApiError.notFound('Address not found');
  address.deleteOne();
  await normaliseDefault(user);
  await user.save();
  ok(res, user.addresses);
});

export default router;

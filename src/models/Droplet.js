import mongoose from 'mongoose';

const DropletSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      index: true,
    },
    telegramId: { type: Number, required: true, index: true },
    dropletId: { type: Number, required: true, index: true },
    name: { type: String, required: true },
    region: { type: String },
    sizeSlug: { type: String },
    imageSlug: { type: String },
    imageName: { type: String },
    ipv4: { type: String },
    rootPasswordEnc: { type: String },
    createdAt: { type: Date, default: () => new Date() },
    expiresAt: { type: Date, index: true },
    destroyedAt: { type: Date },
    autoDestroy: { type: Boolean, default: true },
    notifiedExpiringSoon: { type: Boolean, default: false },
    notifiedExpired: { type: Boolean, default: false },
  },
  { timestamps: true },
);

DropletSchema.index({ accountId: 1, dropletId: 1 }, { unique: true });

export const Droplet = mongoose.model('Droplet', DropletSchema);

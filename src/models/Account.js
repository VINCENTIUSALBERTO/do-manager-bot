import mongoose from 'mongoose';

const AccountSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, required: true, index: true },
    label: { type: String, required: true },
    // AES-256-GCM payload from services/crypto.js — never stored as plaintext.
    apiTokenEnc: { type: String, required: true },
    // Last fetched metadata so list views render quickly without an extra API hit.
    doUuid: { type: String },
    doEmail: { type: String },
    dropletLimit: { type: Number, default: 0 },
    dropletCount: { type: Number, default: 0 },
    balance: { type: String },
    monthUsage: { type: String },
    lastSyncedAt: { type: Date },
  },
  { timestamps: true },
);

AccountSchema.index({ telegramId: 1, label: 1 }, { unique: true });

export const Account = mongoose.model('Account', AccountSchema);

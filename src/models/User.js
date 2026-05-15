import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: { type: String },
    firstName: { type: String },
    languageCode: { type: String },
    activeAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
  },
  { timestamps: true },
);

export const User = mongoose.model('User', UserSchema);

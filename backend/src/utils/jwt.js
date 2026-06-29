const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { supabase } = require('../config/database');

const signAccessToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  });

const signRefreshToken = async (userId) => {
  const token = crypto.randomBytes(40).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase.from('refresh_tokens').insert({
    user_id: userId,
    token_hash: hash,
    expires_at: expiresAt,
  });
  if (error) throw new Error(error.message);

  return token;
};

const verifyAccessToken = (token) => jwt.verify(token, process.env.JWT_SECRET);

const verifyRefreshToken = async (token) => {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const { data, error } = await supabase
    .from('refresh_tokens')
    .select('*')
    .eq('token_hash', hash)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !data) throw new Error('Invalid refresh token');
  return data;
};

const deleteRefreshToken = async (token) => {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await supabase.from('refresh_tokens').delete().eq('token_hash', hash);
};

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  deleteRefreshToken,
};

import { EncryptionService } from './encryption.service';

describe('encryption service', () => {
  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
  });

  it('encrypts and decrypts value', () => {
    const service = new EncryptionService();
    const encrypted = service.encrypt('secret-token');
    const plain = service.decrypt(encrypted);

    expect(plain).toBe('secret-token');
    expect(encrypted.ciphertext).not.toBe('secret-token');
  });
});

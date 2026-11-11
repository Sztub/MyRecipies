import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb, settings } from '../../db';
import { resetI18nForTests, setLanguage, t } from '../../i18n';
import { clearKey } from '../../lib/crypto';
import { loadGitHubForm, saveGitHubForm } from '../settings/githubConfig';
import { collectPairingData } from './apply';
import { PairingSection } from './PairingSection';
import { decodePairing, encodePairing, formatCode, PAIRING_PREFIX } from './payload';

const TOKEN = 'test-token-pairing-ui-123';
const jsqrResult = vi.hoisted(() => ({ data: null as string | null }));
vi.mock('jsqr', () => ({
  default: vi.fn(() => (jsqrResult.data === null ? null : { data: jsqrResult.data })),
}));

function renderSection(props: { onPaired?: () => void } = {}) {
  return render(
    <MemoryRouter>
      <PairingSection iterations={1000} {...props} />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  resetI18nForTests();
  await resetDb();
  await clearKey();
  jsqrResult.data = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function configureSender() {
  await saveGitHubForm({
    owner: 'octo',
    repo: 'data',
    branch: 'main',
    basePath: 'fam',
    token: TOKEN,
  });
  await settings.set('backupKeepLast', 25);
  await settings.set('backupKeepDaily', 7);
}

describe('PairingSection – sender', () => {
  it('shows a QR code, a one-time code and the copyable text; the token is not on screen', async () => {
    await configureSender();
    setLanguage('en');
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole('button', { name: t('pairing.send') }));
    const dialog = await screen.findByRole('dialog', { name: t('pairing.send.title') });
    const code = (await within(dialog).findByTestId('pairing-code')).textContent ?? '';
    expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    await waitFor(() =>
      expect(dialog.querySelector('[data-testid="pairing-qr"] svg path')).not.toBeNull(),
    );
    const text = (within(dialog).getByLabelText(t('pairing.send.textLabel')) as HTMLTextAreaElement)
      .value;
    expect(text.startsWith(PAIRING_PREFIX)).toBe(true);
    expect(document.body.innerHTML).not.toContain(TOKEN);

    const data = await decodePairing(text, code);
    expect(data.github).toEqual({
      owner: 'octo',
      repo: 'data',
      branch: 'main',
      basePath: 'fam',
      token: TOKEN,
    });
    expect(data).toMatchObject({ language: 'en', backupKeepLast: 25, backupKeepDaily: 7 });
    expect(Object.keys(data).sort()).toEqual(
      ['backupKeepDaily', 'backupKeepLast', 'createdAt', 'github', 'language', 'v'].sort(),
    );

    await user.click(within(dialog).getByRole('button', { name: t('pairing.close') }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // Re-opening gives a new code.
    await user.click(screen.getByRole('button', { name: t('pairing.send') }));
    const code2 = await screen.findByTestId('pairing-code');
    expect(code2.textContent).not.toBe(code);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks to set up GitHub first when this device has no token', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole('button', { name: t('pairing.send') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t('pairing.send.notConfigured'));
  });
});

/** Fake camera: a MediaStream whose track records stop(), plus a "playing" <video>. */
function mockCamera() {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  const getUserMedia = vi.fn(() => Promise.resolve(stream));
  vi.stubGlobal(
    'navigator',
    Object.assign(Object.create(navigator) as Navigator, { mediaDevices: { getUserMedia } }),
  );
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1280);
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(720);
  // srcObject isn't implemented by jsdom.
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    set() {},
    get: () => null,
  });
  const ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    })),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  return { getUserMedia, stop, ctx };
}

async function makePayload(code: string) {
  await configureSender();
  const data = await collectPairingData();
  if (!data) throw new Error('not configured');
  const payload = await encodePairing(data, code, { iterations: 1000 });
  await resetDb(); // the receiver is a fresh device
  return payload;
}

describe('PairingSection – receiver', () => {
  it('scans the QR with the (mocked) camera, saves settings + token and asks for the passphrase', async () => {
    const code = 'ABCDEFGHJK';
    const payload = await makePayload(code);
    const cam = mockCamera();
    const onPaired = vi.fn();
    const user = userEvent.setup();
    renderSection({ onPaired });

    await user.click(screen.getByRole('button', { name: t('pairing.receive') }));
    const dialog = await screen.findByRole('dialog', { name: t('pairing.receive.title') });
    jsqrResult.data = 'https://example.com/not-ours'; // other QR codes are ignored
    await user.click(within(dialog).getByRole('button', { name: t('pairing.receive.camera') }));
    expect(cam.getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    expect(await within(dialog).findByLabelText(t('pairing.receive.video'))).toBeInTheDocument();
    await waitFor(() => expect(cam.ctx.getImageData).toHaveBeenCalled());
    // Big frames are downscaled before decoding.
    expect(cam.ctx.getImageData).toHaveBeenCalledWith(0, 0, 640, 360);
    expect(cam.stop).not.toHaveBeenCalled();

    jsqrResult.data = payload;
    expect(await within(dialog).findByText(t('pairing.receive.scanned'))).toBeInTheDocument();
    expect(cam.stop).toHaveBeenCalled();
    expect(within(dialog).getByLabelText(t('pairing.receive.pasteLabel'))).toHaveValue(payload);

    await user.type(
      within(dialog).getByLabelText(t('pairing.receive.codeLabel')),
      formatCode(code).toLowerCase(),
    );
    await user.click(within(dialog).getByRole('button', { name: t('pairing.receive.submit') }));

    expect(await within(dialog).findByText(t('pairing.receive.done'))).toBeInTheDocument();
    expect(within(dialog).getByText(t('pairing.receive.passphrase'))).toBeInTheDocument();
    expect(within(dialog).getByLabelText(t('backup.unlock.passphrase'))).toBeInTheDocument();
    expect(onPaired).toHaveBeenCalledTimes(1);
    expect(await loadGitHubForm()).toEqual({
      owner: 'octo',
      repo: 'data',
      branch: 'main',
      basePath: 'fam',
      token: TOKEN,
    });
    expect(await settings.get('backupKeepLast')).toBe(25);
    expect(await settings.get('backupKeepDaily')).toBe(7);
    // Stored encrypted at rest, never in plain text.
    expect(await settings.get('githubToken')).not.toContain(TOKEN);
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it('stops the camera when the dialog closes', async () => {
    const cam = mockCamera();
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole('button', { name: t('pairing.receive') }));
    await user.click(screen.getByRole('button', { name: t('pairing.receive.camera') }));
    await waitFor(() => expect(cam.ctx.getImageData).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: t('pairing.close') }));
    expect(cam.stop).toHaveBeenCalled();
  });

  it('explains a refused camera and keeps the paste fallback', async () => {
    const getUserMedia = vi.fn(() => Promise.reject(new DOMException('no', 'NotAllowedError')));
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(navigator) as Navigator, { mediaDevices: { getUserMedia } }),
    );
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole('button', { name: t('pairing.receive') }));
    await user.click(screen.getByRole('button', { name: t('pairing.receive.camera') }));
    expect(await screen.findByText(t('pairing.receive.cameraDenied'))).toBeInTheDocument();
    expect(screen.getByLabelText(t('pairing.receive.pasteLabel'))).toBeInTheDocument();
  });

  it('pasted text: wrong code, garbled text and bad code format are reported; nothing is saved', async () => {
    const payload = await makePayload('ABCDEFGHJK');
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole('button', { name: t('pairing.receive') }));
    const textBox = screen.getByLabelText(t('pairing.receive.pasteLabel'));
    const codeBox = screen.getByLabelText(t('pairing.receive.codeLabel'));
    const submit = screen.getByRole('button', { name: t('pairing.receive.submit') });

    await user.click(textBox);
    await user.paste('just some text');
    await user.type(codeBox, 'ABCDEFGHJK');
    await user.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(t('pairing.error.garbled'));

    await user.clear(textBox);
    await user.click(textBox);
    await user.paste(payload);
    await user.clear(codeBox);
    await user.type(codeBox, 'ABC');
    await user.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(t('pairing.error.codeFormat'));

    await user.clear(codeBox);
    await user.type(codeBox, 'ABCDEFGHJM');
    await user.click(submit);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(t('pairing.error.wrong-code')),
    );
    expect((await loadGitHubForm()).token).toBe('');
  });
});

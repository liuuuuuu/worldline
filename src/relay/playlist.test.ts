import { describe, expect, it } from 'vitest';
import { isPlaylist, rewritePlaylist } from './playlist';

const BASE = 'http://stream.example.com/hls/master.m3u8';
const proxy = (url: string): string => `/api/stream?u=${encodeURIComponent(url)}`;

describe('rewritePlaylist', () => {
  it('rewrites bare segment URLs', () => {
    const input = ['#EXTM3U', '#EXTINF:10,', 'segment0.ts', 'segment1.ts'].join('\n');
    const output = rewritePlaylist(input, { baseUrl: BASE, proxy });

    expect(output).toContain(
      `/api/stream?u=${encodeURIComponent('http://stream.example.com/hls/segment0.ts')}`,
    );
    expect(output).toContain(
      `/api/stream?u=${encodeURIComponent('http://stream.example.com/hls/segment1.ts')}`,
    );
    // No un-rewritten bare URL survives.
    expect(output.split('\n').some((line) => line === 'segment0.ts')).toBe(false);
  });

  it('resolves relative paths against the playlist URL, not the page', () => {
    const input = 'sub/segment.ts';
    const output = rewritePlaylist(input, { baseUrl: BASE, proxy });

    expect(output).toBe(proxy('http://stream.example.com/hls/sub/segment.ts'));
  });

  it('handles root-relative paths', () => {
    const output = rewritePlaylist('/media/a.ts', { baseUrl: BASE, proxy });
    expect(output).toBe(proxy('http://stream.example.com/media/a.ts'));
  });

  it('leaves absolute URLs absolute', () => {
    const output = rewritePlaylist('http://other.example.net/a.ts', { baseUrl: BASE, proxy });
    expect(output).toBe(proxy('http://other.example.net/a.ts'));
  });

  it('rewrites child playlists in a master playlist', () => {
    const input = ['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=128000', 'low/index.m3u8'].join('\n');
    const output = rewritePlaylist(input, { baseUrl: BASE, proxy });

    expect(output).toContain(proxy('http://stream.example.com/hls/low/index.m3u8'));
    // The tag itself is untouched.
    expect(output).toContain('#EXT-X-STREAM-INF:BANDWIDTH=128000');
  });

  it('rewrites URI= attributes, not just bare lines', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/index.m3u8"',
    ].join('\n');

    const output = rewritePlaylist(input, { baseUrl: BASE, proxy });

    expect(output).toContain(`URI="${proxy('http://stream.example.com/hls/key.bin')}"`);
    expect(output).toContain(`URI="${proxy('http://stream.example.com/hls/init.mp4')}"`);
    expect(output).toContain(`URI="${proxy('http://stream.example.com/hls/audio/index.m3u8')}"`);
    // The tag names survive.
    expect(output).toContain('#EXT-X-KEY:METHOD=AES-128,');
    expect(output).toContain('#EXT-X-MAP:');
  });

  it('leaves an empty URI attribute alone', () => {
    const output = rewritePlaylist('#EXT-X-KEY:METHOD=NONE,URI=""', { baseUrl: BASE, proxy });
    expect(output).toBe('#EXT-X-KEY:METHOD=NONE,URI=""');
  });

  it('preserves tags it does not understand', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      '#EXT-X-TARGETDURATION:6',
      '#EXT-X-MEDIA-SEQUENCE:42',
      '#EXT-X-PROGRAM-DATE-TIME:2026-10-07T12:00:00Z',
      '#EXT-X-ENDLIST',
    ].join('\n');

    expect(rewritePlaylist(input, { baseUrl: BASE, proxy })).toBe(input);
  });

  it('preserves blank lines and the trailing newline structure', () => {
    const input = '#EXTM3U\n\n#EXTINF:10,\na.ts\n';
    const output = rewritePlaylist(input, { baseUrl: BASE, proxy });

    expect(output.split('\n')[1]).toBe('');
    expect(output.endsWith('\n')).toBe(true);
  });

  it('tolerates CRLF playlists', () => {
    const input = '#EXTM3U\r\n#EXTINF:10,\r\na.ts\r\n';
    const output = rewritePlaylist(input, { baseUrl: BASE, proxy });

    // The segment line still gets rewritten; only the trailing \r is trimmed.
    expect(output).toContain(proxy('http://stream.example.com/hls/a.ts'));
  });

  it('leaves a malformed base URL rather than throwing', () => {
    const output = rewritePlaylist('a.ts', { baseUrl: 'not-a-url', proxy });
    expect(output).toBe(proxy('a.ts'));
  });
});

describe('isPlaylist', () => {
  it('detects by content type', () => {
    expect(isPlaylist('application/vnd.apple.mpegurl', 'http://x/y')).toBe(true);
    expect(isPlaylist('application/x-mpegURL', 'http://x/y')).toBe(true);
    expect(isPlaylist('audio/mpeg', 'http://x/y.mp3')).toBe(false);
  });

  it('detects by extension when the type is generic', () => {
    expect(isPlaylist('application/octet-stream', 'http://x/y.m3u8')).toBe(true);
    expect(isPlaylist('application/octet-stream', 'http://x/y.m3u8?token=abc')).toBe(true);
    expect(isPlaylist('application/octet-stream', 'http://x/y.mp3')).toBe(false);
  });
});

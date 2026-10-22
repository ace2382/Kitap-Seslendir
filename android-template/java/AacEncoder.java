package com.kitapseslendir.app;

import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;

/**
 * 16 bit PCM verisini Android'in yerleşik MediaCodec kodlayıcısıyla AAC'ye çevirip
 * MPEG-4 (.m4a) kapsayıcısına yazar. Harici kütüphane / lisans bağımlılığı yoktur
 * (FFmpegKit emekli edildi ve GPL varyantı gerekiyordu).
 */
final class AacEncoder {
    private static final long TIMEOUT_US = 10_000;
    private static final int BIT_RATE = 64_000; // konuşma için yeterli, dosya küçük kalır

    private final MediaCodec codec;
    private final MediaMuxer muxer;
    private final MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
    private final int sampleRate;
    private final int frameBytes;
    private int track = -1;
    private boolean muxerStarted = false;
    private boolean finished = false;
    private long pcmBytes = 0;

    AacEncoder(File out, int sampleRate, int channels) throws IOException {
        this.sampleRate = sampleRate;
        this.frameBytes = channels * 2;
        MediaFormat format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, channels);
        format.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
        format.setInteger(MediaFormat.KEY_BIT_RATE, BIT_RATE);
        format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16 * 1024);
        MediaCodec c = null;
        MediaMuxer m = null;
        try {
            c = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
            c.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            c.start();
            m = new MediaMuxer(out.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
        } catch (IOException | RuntimeException e) {
            if (c != null) try { c.release(); } catch (Exception ignored) {}
            if (m != null) try { m.release(); } catch (Exception ignored) {}
            throw new IOException("AAC kodlayıcı başlatılamadı: " + e.getMessage(), e);
        }
        this.codec = c;
        this.muxer = m;
    }

    long durationMs() {
        return pcmBytes * 1000L / ((long) sampleRate * frameBytes);
    }

    void write(byte[] data, int offset, int length) throws IOException {
        int pos = offset;
        int end = offset + length - (length % frameBytes);
        while (pos < end) {
            int index = codec.dequeueInputBuffer(TIMEOUT_US);
            if (index >= 0) {
                ByteBuffer in = codec.getInputBuffer(index);
                if (in == null) throw new IOException("Kodlayıcı giriş arabelleği alınamadı.");
                in.clear();
                int n = Math.min(in.remaining(), end - pos);
                n -= n % frameBytes;
                if (n <= 0) throw new IOException("Kodlayıcı giriş arabelleği çok küçük.");
                in.put(data, pos, n);
                codec.queueInputBuffer(index, 0, n, ptsUs(), 0);
                pos += n;
                pcmBytes += n;
            }
            drain(false);
        }
    }

    /** Parçalar arasına doğal bir duraklama için sessizlik ekler. */
    void writeSilence(int millis) throws IOException {
        long bytes = (long) sampleRate * frameBytes * millis / 1000L;
        bytes -= bytes % frameBytes;
        byte[] zeros = new byte[8192 - (8192 % frameBytes)];
        while (bytes > 0) {
            int n = (int) Math.min(zeros.length, bytes);
            write(zeros, 0, n);
            bytes -= n;
        }
    }

    /** Akışı kapatır ve .m4a dosyasını tamamlar. */
    void finish() throws IOException {
        if (finished) return;
        finished = true;
        while (true) {
            int index = codec.dequeueInputBuffer(TIMEOUT_US);
            if (index >= 0) {
                codec.queueInputBuffer(index, 0, 0, ptsUs(), MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                break;
            }
            drain(false);
        }
        drain(true);
        if (!muxerStarted) throw new IOException("Hiç ses verisi yazılamadı.");
        muxer.stop();
    }

    /** Başarılı da olsa başarısız da olsa çağrılır. */
    void release() {
        try { codec.stop(); } catch (Exception ignored) {}
        try { codec.release(); } catch (Exception ignored) {}
        try { muxer.release(); } catch (Exception ignored) {}
    }

    private long ptsUs() {
        return pcmBytes * 1_000_000L / ((long) sampleRate * frameBytes);
    }

    private void drain(boolean endOfStream) throws IOException {
        int idleSpins = 0;
        while (true) {
            int index = codec.dequeueOutputBuffer(info, endOfStream ? TIMEOUT_US : 0);
            if (index == MediaCodec.INFO_TRY_AGAIN_LATER) {
                if (!endOfStream) return;
                if (++idleSpins > 500) throw new IOException("AAC kodlayıcı yanıt vermedi.");
            } else if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                if (muxerStarted) throw new IOException("Kodlayıcı biçimi akış sırasında değişti.");
                track = muxer.addTrack(codec.getOutputFormat());
                muxer.start();
                muxerStarted = true;
            } else if (index >= 0) {
                ByteBuffer buf = codec.getOutputBuffer(index);
                if ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) info.size = 0;
                if (buf != null && info.size > 0 && muxerStarted) {
                    buf.position(info.offset);
                    buf.limit(info.offset + info.size);
                    muxer.writeSampleData(track, buf, info);
                }
                codec.releaseOutputBuffer(index, false);
                if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) return;
                idleSpins = 0;
            }
        }
    }
}

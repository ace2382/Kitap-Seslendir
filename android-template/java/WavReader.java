package com.kitapseslendir.app;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;

/**
 * Android TTS'in synthesizeToFile ile yazdığı WAV başlığını ayrıştırır.
 * Android'e bağımlı değildir (JVM'de test edilebilir). Bazı motorlar veri uzunluğunu
 * 0 / 0xFFFFFFFF yazar; bu durumda dosyanın geri kalanı veri sayılır.
 */
final class WavReader {
    static final class Info {
        int sampleRate;
        int channels;
        int bitsPerSample;
        long dataOffset;
        long dataLength;
    }

    private WavReader() {}

    static Info parse(File file) throws IOException {
        long fileLength = file.length();
        try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
            if (fileLength < 12) throw new IOException("WAV dosyası çok kısa.");
            byte[] head = new byte[12];
            raf.readFully(head);
            if (!"RIFF".equals(ascii(head, 0)) || !"WAVE".equals(ascii(head, 8))) {
                throw new IOException("Geçerli bir WAV dosyası değil.");
            }
            Info info = new Info();
            boolean haveFmt = false;
            long pos = 12;
            byte[] hdr = new byte[8];
            while (pos + 8 <= fileLength) {
                raf.seek(pos);
                raf.readFully(hdr);
                String id = ascii(hdr, 0);
                long size = le32(hdr, 4);
                long body = pos + 8;
                if ("fmt ".equals(id)) {
                    if (size < 16) throw new IOException("WAV 'fmt' bölümü bozuk.");
                    byte[] fmt = new byte[16];
                    raf.seek(body);
                    raf.readFully(fmt);
                    int format = le16(fmt, 0);
                    if (format != 1 && format != 0xFFFE) throw new IOException("Desteklenmeyen WAV biçimi: " + format);
                    info.channels = le16(fmt, 2);
                    info.sampleRate = (int) le32(fmt, 4);
                    info.bitsPerSample = le16(fmt, 14);
                    haveFmt = true;
                } else if ("data".equals(id)) {
                    if (!haveFmt) throw new IOException("WAV 'data' bölümünden önce 'fmt' yok.");
                    long available = fileLength - body;
                    info.dataOffset = body;
                    info.dataLength = (size == 0 || size == 0xFFFFFFFFL || size > available) ? available : size;
                    if (info.channels < 1 || info.channels > 2) throw new IOException("Desteklenmeyen kanal sayısı: " + info.channels);
                    if (info.bitsPerSample != 16) throw new IOException("Yalnızca 16 bit PCM destekleniyor.");
                    if (info.sampleRate < 8000 || info.sampleRate > 48000) throw new IOException("Desteklenmeyen örnekleme hızı: " + info.sampleRate);
                    return info;
                }
                pos = body + size + (size & 1);
            }
            throw new IOException("WAV içinde ses verisi bulunamadı.");
        }
    }

    private static String ascii(byte[] b, int off) {
        return new String(b, off, 4, StandardCharsets.US_ASCII);
    }

    private static int le16(byte[] b, int off) {
        return (b[off] & 0xFF) | ((b[off + 1] & 0xFF) << 8);
    }

    private static long le32(byte[] b, int off) {
        return (b[off] & 0xFFL) | ((b[off + 1] & 0xFFL) << 8) | ((b[off + 2] & 0xFFL) << 16) | ((b[off + 3] & 0xFFL) << 24);
    }
}

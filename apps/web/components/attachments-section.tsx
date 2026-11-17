'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { api, describeFailure } from '../lib/api';
import { Notice } from './form';
import { useT } from '../lib/i18n';

interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  status: 'pending' | 'quarantined' | 'clean' | 'rejected';
  rejectionReason: string | null;
  uploadedBy: { userId: string; displayName: string };
}

const ACCEPT =
  'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv';
const MAX_BYTES = 10 * 1024 * 1024;

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const REASONS: Record<string, string> = {
  type: 'its content is not the type it claims',
  malware: 'it failed the malware check',
  size: 'the upload was incomplete',
};

/** Files on a task: upload, check status, download, delete (ADR-034). */
export function AttachmentsSection({
  base,
  number,
  userId,
  canWrite,
  canManage,
}: {
  base: string;
  number: string;
  userId: string;
  canWrite: boolean;
  canManage: boolean;
}) {
  const t = useT();
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: 'info' | 'error';
    text: string;
  }>();
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const result = await api<Attachment[]>(
      `${base}/tasks/${number}/attachments`,
    );
    setItems(result.data ?? []);
  }, [base, number]);

  useEffect(() => {
    void load();
  }, [load]);

  // Files being checked are polled until the worker decides.
  const waiting = items.some((i) => i.status === 'quarantined');
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [waiting, load]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setMessage({ tone: 'error', text: `${file.name} is larger than 10 MB.` });
      return;
    }
    setBusy(true);
    setMessage({ tone: 'info', text: `Uploading ${file.name}…` });
    try {
      const created = await api<{
        attachment: Attachment;
        upload: { url: string; headers: Record<string, string> };
      }>(`${base}/tasks/${number}/attachments`, {
        method: 'POST',
        body: { filename: file.name, contentType: file.type, size: file.size },
      });
      if (!created.data) {
        setMessage({
          tone: 'error',
          text: describeFailure(
            created.status,
            created.status === 400
              ? `${file.name} is not a supported type. Use an image, PDF, text or CSV file.`
              : `${file.name} could not be uploaded.`,
          ),
        });
        return;
      }
      const put = await fetch(created.data.upload.url, {
        method: 'PUT',
        headers: created.data.upload.headers,
        body: file,
      });
      if (!put.ok) {
        setMessage({
          tone: 'error',
          text: `${file.name} could not be uploaded.`,
        });
        return;
      }
      const done = await api(
        `${base}/attachments/${created.data.attachment.id}/complete`,
        { method: 'POST' },
      );
      setMessage(
        done.ok
          ? {
              tone: 'info',
              text: `${file.name} uploaded. Checking it before anyone can download it.`,
            }
          : {
              tone: 'error',
              text: `${file.name} did not arrive completely. Try again.`,
            },
      );
    } catch {
      setMessage({
        tone: 'error',
        text: `${file.name} could not be uploaded.`,
      });
    } finally {
      setBusy(false);
      await load();
    }
  }

  async function remove(item: Attachment) {
    if (!window.confirm(`Delete ${item.filename}?`)) return;
    await api(`${base}/attachments/${item.id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <section className="section" aria-labelledby="attachments-heading">
      <h2 id="attachments-heading">{t('Attachments')}</h2>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {items.length === 0 ? (
        <p className="muted">{t('No files yet.')}</p>
      ) : null}
      <ul className="rows">
        {items.map((item) => (
          <li key={item.id}>
            <span className="grow">
              {item.status === 'clean' ? (
                <a
                  className="title"
                  href={`/api${base}/attachments/${item.id}/download`}
                >
                  {item.filename}
                </a>
              ) : (
                <span className="title">{item.filename}</span>
              )}
              <br />
              <span className="muted">
                {size(item.size)}, {item.uploadedBy.displayName}
                {item.status === 'quarantined' ? ', checking…' : ''}
                {item.status === 'rejected'
                  ? `, rejected because ${REASONS[item.rejectionReason ?? ''] ?? 'it failed the checks'}`
                  : ''}
              </span>
            </span>
            {canWrite && (item.uploadedBy.userId === userId || canManage) ? (
              <button
                className="button danger small"
                type="button"
                onClick={() => void remove(item)}
              >
                {t('Delete')}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canWrite ? (
        <div className="field section">
          <label htmlFor="attachmentFile">
            {t('Add a file (images, PDF, text or CSV, up to 10 MB)')}
          </label>
          <input
            id="attachmentFile"
            ref={input}
            type="file"
            accept={ACCEPT}
            disabled={busy}
            onChange={(event) => void upload(event)}
          />
        </div>
      ) : null}
    </section>
  );
}

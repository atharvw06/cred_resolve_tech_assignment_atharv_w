import React, { useState } from 'react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm Action',
  onConfirm,
  onCancel,
}) => {
  const [reason, setReason] = useState('Routine operational test cycle');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(reason);
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onClick={onCancel}
    >
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-modal-title" className="modal-title" style={{ color: '#fda4af' }}>
          ⚠️ {title}
        </h3>
        <p className="modal-body">{message}</p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '18px' }}>
            <label
              htmlFor="audit-reason-input"
              style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}
            >
              Mandatory Operational Reason (Logged to Audit Trail):
            </label>
            <input
              id="audit-reason-input"
              type="text"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="E.g., Testing scenario recovery baseline"
              style={{
                width: '100%',
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '13px',
              }}
            />
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Actor: <strong>Supervisor: Sarah Jenkins</strong> (Timestamp: {new Date().toLocaleTimeString()})
            </div>
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="action-btn"
              style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="action-btn btn-danger"
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

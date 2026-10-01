import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface DialogProps { title: string; onClose: () => void; children: ReactNode; className?: string }

export function Dialog({ title, onClose, children, className = '' }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    element.showModal()
    const cancel = (event: Event) => { event.preventDefault(); closeRef.current() }
    element.addEventListener('cancel', cancel)
    return () => { element.removeEventListener('cancel', cancel); element.close() }
  }, [])
  return <dialog ref={dialog} className={`dialog ${className}`} aria-label={title}>
    <div className="dialog-title"><h2>{title}</h2><button className="icon-button" aria-label={`关闭${title}`} onClick={onClose}><X size={18} /></button></div>
    {children}
  </dialog>
}

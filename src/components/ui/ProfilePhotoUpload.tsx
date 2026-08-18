import { useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';

interface ProfilePhotoUploadProps {
  photo: string | null;
  onPhotoChange: (photo: string | null) => void;
  userName?: string;
}

export default function ProfilePhotoUpload({ photo, onPhotoChange, userName }: ProfilePhotoUploadProps) {
  const [preview, setPreview] = useState<string | null>(photo);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Por favor, selecione uma imagem válida');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('A imagem deve ter no máximo 5MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setPreview(dataUrl);
      onPhotoChange(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = () => {
    setPreview(null);
    onPhotoChange(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const initials = userName
    ? userName.split(' ').map((n) => n.charAt(0)).join('').toUpperCase().slice(0, 2)
    : 'U';

  return (
    <div className="flex items-center gap-4 mb-6">
      <div className="relative">
        {preview ? (
          <img
            src={preview}
            alt="Profile"
            className="w-16 h-16 rounded-full object-cover border border-border"
          />
        ) : (
          <div className="w-16 h-16 rounded-full bg-primary/10 border border-border flex items-center justify-center text-primary font-semibold text-base">
            {initials}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileSelect(f);
          }}
          className="hidden"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/70 text-foreground transition-all border border-border"
        >
          <Camera size={13} />
          {preview ? 'Trocar foto' : 'Adicionar foto'}
        </button>
        {preview && (
          <button
            type="button"
            onClick={handleRemovePhoto}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-all"
            title="Remover foto"
          >
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

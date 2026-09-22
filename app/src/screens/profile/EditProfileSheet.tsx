import { useState } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '../../components/ui/field';
import {
  Sheet,
  SheetBackdrop,
  SheetClose,
  SheetPopup,
  SheetPortal,
  SheetTitle,
} from '../../components/ui/sheet';
import { cn } from '../../lib/utils';
import { type MyProfile, useUpdateMyProfile } from '../../queries/profile';

const AVATAR_PALETTE = [
  { name: 'Roșu OSUBB', color: '#ED2025' },
  { name: 'Educațional', color: '#284C93' },
  { name: 'Financiar', color: '#007F33' },
  { name: 'Resurse Umane', color: '#F2A700' },
  { name: 'Imagine & PR', color: '#7500A0' },
  { name: 'Tineret', color: '#FF3B3B' },
  { name: 'Negru', color: '#0B0B0C' },
];

export type EditProfileSheetProps = {
  open: boolean;
  onClose: () => void;
  profile: MyProfile;
};

function EditProfileForm({
  profile,
  onClose,
}: {
  profile: MyProfile;
  onClose: () => void;
}) {
  const [fullName, setFullName] = useState(profile.full_name);
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [avatarColor, setAvatarColor] = useState(
    profile.avatar_color ?? '#ED2025',
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const updateMutation = useUpdateMyProfile();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = fullName.trim();
    if (!trimmedName) {
      setNameError('Numele complet este obligatoriu.');
      return;
    }
    setNameError(null);
    setSubmitError(null);

    try {
      await updateMutation.mutateAsync({
        fullName: trimmedName,
        phone: phone.trim() || null,
        avatarColor,
      });
      onClose();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Nu am putut salva modificările.',
      );
    }
  };

  return (
    <>
      {submitError && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="size-4 shrink-0" />
          <span>{submitError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <Field>
          <FieldLabel htmlFor="edit-profile-name">Nume complet</FieldLabel>
          <input
            id="edit-profile-name"
            type="text"
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              if (nameError) setNameError(null);
            }}
            className={cn(
              'flex min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
              nameError &&
                'border-destructive focus-visible:border-destructive',
            )}
          />
          {nameError && <FieldError errors={[{ message: nameError }]} />}
        </Field>

        <Field>
          <FieldLabel htmlFor="edit-profile-email">Adresă de email</FieldLabel>
          <input
            id="edit-profile-email"
            type="email"
            value={profile.email ?? ''}
            disabled
            className="flex min-h-11 w-full cursor-not-allowed rounded-lg border border-input bg-muted px-3 py-2 text-sm text-muted-foreground opacity-75 outline-none"
          />
          <FieldDescription>
            Adresa de email este identificatorul contului tău. Pentru
            modificări, contactează Biroul de Conducere.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="edit-profile-phone">Număr de telefon</FieldLabel>
          <input
            id="edit-profile-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="ex: 0712345678"
            className="flex min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <FieldDescription>
            Numărul de telefon este vizibil doar pentru tine și membrii cu nivel
            ≥5.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel>Culoare avatar</FieldLabel>
          <div
            className="flex flex-wrap gap-2 pt-1"
            role="group"
            aria-label="Alege culoarea avatarului"
          >
            {AVATAR_PALETTE.map((swatch) => {
              const isSelected =
                avatarColor.toLowerCase() === swatch.color.toLowerCase();
              return (
                <button
                  key={swatch.color}
                  type="button"
                  onClick={() => setAvatarColor(swatch.color)}
                  aria-label={swatch.name}
                  aria-pressed={isSelected}
                  style={{ backgroundColor: swatch.color }}
                  className={cn(
                    'grid size-11 place-items-center rounded-full text-white transition-transform motion-reduce:transition-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2',
                    isSelected
                      ? 'scale-110 ring-2 ring-foreground ring-offset-2'
                      : 'hover:scale-105',
                  )}
                >
                  {isSelected && (
                    <Check className="size-4 stroke-[3]" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="mt-4 flex items-center justify-end gap-3 border-t border-border pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={updateMutation.isPending}
          >
            Anulează
          </Button>
          <Button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending
              ? 'Se salvează…'
              : 'Salvează modificările'}
          </Button>
        </div>
      </form>
    </>
  );
}

export default function EditProfileSheet({
  open,
  onClose,
  profile,
}: EditProfileSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <SheetPortal>
        <SheetBackdrop />
        <SheetPopup
          className="right-0 left-auto w-full max-w-md overflow-y-auto p-4 sm:p-6"
          aria-describedby={undefined}
        >
          <div className="mb-5 flex items-center justify-between gap-3 border-b border-border pb-4">
            <SheetTitle className="font-heading text-xl font-semibold">
              Editează profilul
            </SheetTitle>
            <SheetClose className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-input px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
              Închide
            </SheetClose>
          </div>

          {open && <EditProfileForm profile={profile} onClose={onClose} />}
        </SheetPopup>
      </SheetPortal>
    </Sheet>
  );
}

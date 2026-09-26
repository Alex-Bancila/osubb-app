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
import { normalizePhone } from '../../lib/normalize';
import { fieldForReason, profileSchema } from '../../lib/schemas/profile';
import { useFormValidation } from '../../lib/use-form-validation';
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

const INPUT_CLASS =
  'flex min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive';

const LOCKED_INPUT_CLASS =
  'flex min-h-11 w-full cursor-not-allowed rounded-lg border border-input bg-muted px-3 py-2 text-sm text-muted-foreground opacity-75 outline-none';

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
  const [nickname, setNickname] = useState(profile.nickname ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [avatarColor, setAvatarColor] = useState(
    profile.avatar_color ?? '#ED2025',
  );
  const updateMutation = useUpdateMyProfile();
  // #675 (R5): the full name is a privileged column, changed only by BC or the
  // Moderator, so this form shows it and never sends it. The Nickname, the
  // phone (normalised to E.164, ruling R8) and the colour are the Member's.
  const form = useFormValidation(
    profileSchema,
    { nickname, phone, avatarColor },
    fieldForReason,
  );
  const phoneField = form.field('phone', 'edit-profile-phone-hint');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const values = form.validate();
    if (!values) return;

    try {
      await updateMutation.mutateAsync({
        nickname: values.nickname,
        phone: values.phone,
        avatarColor: values.avatarColor,
      });
      onClose();
    } catch (err) {
      form.fail(err, 'Nu am putut salva modificările.');
    }
  };

  return (
    <>
      {form.formError && (
        <FieldError className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          <span>{form.formError}</span>
        </FieldError>
      )}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <Field>
          <FieldLabel htmlFor="edit-profile-nickname">Pseudonim</FieldLabel>
          <input
            id="edit-profile-nickname"
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            autoComplete="nickname"
            className={INPUT_CLASS}
            {...form.field('nickname', 'edit-profile-nickname-hint')}
          />
          <FieldError {...form.errorProps('nickname')} />
          <FieldDescription id="edit-profile-nickname-hint">
            2–24 de caractere: litere, cifre, spații, punct, cratimă sau
            underscore. Fără pseudonim, se afișează numele complet.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="edit-profile-name">Nume complet</FieldLabel>
          <input
            id="edit-profile-name"
            type="text"
            value={profile.full_name}
            readOnly
            aria-readonly="true"
            aria-describedby="edit-profile-name-hint"
            className={LOCKED_INPUT_CLASS}
          />
          <FieldDescription id="edit-profile-name-hint">
            Numele complet se schimbă doar de BC sau Moderator.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="edit-profile-email">Adresă de email</FieldLabel>
          <input
            id="edit-profile-email"
            type="email"
            value={profile.email ?? ''}
            disabled
            className={LOCKED_INPUT_CLASS}
          />
          <FieldDescription>
            Adresa de email se schimbă din secțiunea „Adresa de e-mail" de pe
            pagina de profil.
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
            autoComplete="tel"
            className={INPUT_CLASS}
            {...phoneField}
            onBlur={() => {
              phoneField.onBlur();
              // R8: show back the number as it will be stored.
              const normalised = normalizePhone(phone);
              if (normalised !== null) setPhone(normalised);
            }}
          />
          <FieldError {...form.errorProps('phone')} />
          <FieldDescription id="edit-profile-phone-hint">
            Numărul de telefon este vizibil doar pentru tine și membrii cu nivel
            ≥5.
          </FieldDescription>
        </Field>

        <Field {...form.slot('avatarColor')}>
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
          <FieldError {...form.errorProps('avatarColor')} />
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

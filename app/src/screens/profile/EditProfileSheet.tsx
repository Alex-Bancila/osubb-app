import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Field, FieldError, FieldLabel } from '../../components/ui/field';
import { FormSheet, FormSheetFooter } from '../../components/ui/form-sheet';
import { InfoHint } from '../../components/ui/info-hint';
import { Input } from '../../components/ui/input';
import { normalizePhone } from '../../lib/normalize';
import { fieldForReason, profileSchema } from '../../lib/schemas/profile';
import { useFormValidation } from '../../lib/use-form-validation';
import { type MyProfile, useUpdateMyProfile } from '../../queries/profile';
import { ColorPicker } from '../../components/ui/color-picker';
import ChangeEmailSection from './ChangeEmailSection';
import { PHONE_HINT } from './profile-copy';

const FORM_ID = 'edit-profile-form';

/** A field's label with its `InfoHint` at the end of the row. */
const LABEL_ROW_CLASS = 'flex items-center justify-between gap-2';

export type EditProfileSheetProps = {
  open: boolean;
  onClose: () => void;
  profile: MyProfile;
  /** After a successful save, before the sheet closes: Profil's receipt. */
  onSaved?: () => void;
};

function EditProfileForm({
  profile,
  onClose,
  onSaved,
}: {
  profile: MyProfile;
  onClose: () => void;
  onSaved?: () => void;
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
      onSaved?.();
      onClose();
    } catch (err) {
      form.fail(err, 'Nu am putut salva modificările.');
    }
  };

  return (
    <>
      {form.formError && (
        <FieldError className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          <span>{form.formError}</span>
        </FieldError>
      )}

      <form
        id={FORM_ID}
        onSubmit={handleSubmit}
        noValidate
        className="flex flex-col gap-5"
      >
        <Field>
          <div className={LABEL_ROW_CLASS}>
            <FieldLabel htmlFor="edit-profile-nickname">
              Poreclă (opțional)
            </FieldLabel>
            <InfoHint label="Despre poreclă" id="edit-profile-nickname-hint">
              2–24 de caractere: litere, cifre, spații, punct, cratimă sau
              underscore. Fără poreclă, se afișează numele complet.
            </InfoHint>
          </div>
          <Input
            id="edit-profile-nickname"
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            autoComplete="nickname"
            {...form.field('nickname', 'edit-profile-nickname-hint')}
          />
          <FieldError {...form.errorProps('nickname')} />
        </Field>

        <Field>
          <div className={LABEL_ROW_CLASS}>
            <FieldLabel htmlFor="edit-profile-name">Nume complet</FieldLabel>
            <InfoHint label="Despre numele complet" id="edit-profile-name-hint">
              Numele complet se schimbă doar de BC sau Moderator.
            </InfoHint>
          </div>
          {/* Read-only, not disabled: it stays in the tab order and is read
              out, drawn as the shared field's disabled surface. */}
          <Input
            id="edit-profile-name"
            type="text"
            value={profile.full_name}
            readOnly
            aria-readonly="true"
            aria-describedby="edit-profile-name-hint"
            className="cursor-not-allowed bg-muted text-muted-foreground"
          />
        </Field>

        <Field>
          <div className={LABEL_ROW_CLASS}>
            <FieldLabel htmlFor="edit-profile-phone">
              Număr de telefon (opțional)
            </FieldLabel>
            <InfoHint
              label="Despre numărul de telefon"
              id="edit-profile-phone-hint"
            >
              {PHONE_HINT}
            </InfoHint>
          </div>
          <Input
            id="edit-profile-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="ex: 0712345678"
            autoComplete="tel"
            {...phoneField}
            onBlur={() => {
              phoneField.onBlur();
              // R8: show back the number as it will be stored.
              const normalised = normalizePhone(phone);
              if (normalised !== null) setPhone(normalised);
            }}
          />
          <FieldError {...form.errorProps('phone')} />
        </Field>

        <Field {...form.slot('avatarColor')}>
          <FieldLabel>Culoare avatar</FieldLabel>
          <ColorPicker
            label="Alege culoarea avatarului"
            value={avatarColor}
            onChange={setAvatarColor}
          />
          <FieldError {...form.errorProps('avatarColor')} />
        </Field>
      </form>

      {/* #824: the sign-in address changes here too, as its own form below
          the profile form, so the page itself has no email card. */}
      <div className="border-t border-border pt-5">
        <ChangeEmailSection profile={profile} />
      </div>

      {/* The profile form's actions, pinned under both sections: the buttons
          sit outside the form and submit it by its id. */}
      <FormSheetFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={updateMutation.isPending}
        >
          Renunță
        </Button>
        <Button
          type="submit"
          form={FORM_ID}
          disabled={updateMutation.isPending}
        >
          {updateMutation.isPending ? 'Se salvează…' : 'Salvează modificările'}
        </Button>
      </FormSheetFooter>
    </>
  );
}

/**
 * **Editează profilul**: the Member's own Nickname, phone and avatar colour,
 * and under them the request to change the sign-in address — one form sheet,
 * whose pinned **Salvează modificările** saves the profile form.
 */
export default function EditProfileSheet({
  open,
  onClose,
  profile,
  onSaved,
}: EditProfileSheetProps) {
  return (
    <FormSheet
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      title="Editează profilul"
    >
      {open && (
        <EditProfileForm
          profile={profile}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </FormSheet>
  );
}

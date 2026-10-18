import { useId, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Field, FieldError, FieldLabel } from '../../components/ui/field';
import { FormSheet, FormSheetFooter } from '../../components/ui/form-sheet';
import { InfoHint } from '../../components/ui/info-hint';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { normalizePhone } from '../../lib/normalize';
import {
  memberUniversitySchema,
  universityFieldForReason,
} from '../../lib/schemas/member-identity';
import { fieldForReason, profileSchema } from '../../lib/schemas/profile';
import {
  OTHER_UNIVERSITY,
  UNIVERSITY_CHOICES,
  UNIVERSITY_SAVE_FAILED,
  universityDraft,
} from '../../lib/universities';
import { useFormValidation } from '../../lib/use-form-validation';
import { useUpdateMemberUniversity } from '../../queries/admin-member';
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
  /**
   * BC and the Moderator (`manageRoles`) record the Universitate, their own
   * included (R58): for them the sheet carries the field. For everyone else
   * Profil shows it read-only and the sheet neither offers nor sends it.
   */
  canEditUniversity: boolean;
  /** After a successful save, before the sheet closes: Profil's receipt. */
  onSaved?: () => void;
};

function EditProfileForm({
  profile,
  canEditUniversity,
  onClose,
  onSaved,
}: {
  profile: MyProfile;
  canEditUniversity: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const universityNameId = useId();
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

  // R58: the Universitate, as Administrare edits it on a Member's page -- the
  // select's entry and, under "Altă universitate", the typed name.
  const [university, setUniversity] = useState(() =>
    universityDraft(profile.university),
  );
  const universityMutation = useUpdateMemberUniversity();
  const chosenUniversity =
    university.option === OTHER_UNIVERSITY
      ? university.other.trim()
      : university.option;
  // The hook hides a refusal once the value at the field it was shown under
  // changes, and that field is `university`, not the draft's `option` and
  // `other`: the values it reads carry the chosen name under that key.
  const judged = { ...university, university: chosenUniversity };
  const universityForm = useFormValidation(
    memberUniversitySchema,
    judged,
    universityFieldForReason,
  );
  // Only a changed Universitate is judged and written, so a blank one never
  // blocks the profile; choosing "Altă universitate" is a change even before
  // the name is typed.
  const universityChanged =
    canEditUniversity &&
    (university.option !== universityDraft(profile.university).option ||
      chosenUniversity !== (profile.university ?? ''));
  const pending = updateMutation.isPending || universityMutation.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Both forms are judged before anything is written, so every problem shows.
    const values = form.validate();
    const universityValue = universityChanged
      ? universityForm.validate()
      : undefined;
    if (!values || universityValue === null) return;

    // The Universitate is written beside the profile, and the sheet closes
    // only when both are saved; each refusal lands where its field is.
    const [profileResult, universityResult] = await Promise.allSettled([
      updateMutation.mutateAsync({
        nickname: values.nickname,
        phone: values.phone,
        avatarColor: values.avatarColor,
      }),
      universityValue
        ? universityMutation.mutateAsync({
            memberId: profile.id,
            university: universityValue.university,
          })
        : Promise.resolve(),
    ]);
    if (profileResult.status === 'rejected')
      form.fail(profileResult.reason, 'Nu am putut salva modificările.');
    if (universityResult.status === 'rejected')
      universityForm.fail(universityResult.reason, UNIVERSITY_SAVE_FAILED);
    if (
      profileResult.status === 'rejected' ||
      universityResult.status === 'rejected'
    )
      return;
    onSaved?.();
    onClose();
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

        {canEditUniversity && (
          <>
            <Field>
              <FieldLabel htmlFor="edit-profile-university">
                Universitate
              </FieldLabel>
              <Select
                id="edit-profile-university"
                value={university.option}
                placeholder="Alege universitatea"
                options={UNIVERSITY_CHOICES}
                disabled={universityMutation.isPending}
                onValueChange={(option) => {
                  setUniversity({ ...university, option });
                  // A refusal was about the old choice.
                  universityForm.reset();
                }}
              />
              <FieldError>{universityForm.formError}</FieldError>
            </Field>
            {university.option === OTHER_UNIVERSITY && (
              <Field>
                <FieldLabel htmlFor={universityNameId}>
                  Numele universității
                </FieldLabel>
                <Input
                  id={universityNameId}
                  type="text"
                  value={university.other}
                  disabled={universityMutation.isPending}
                  onChange={(e) =>
                    setUniversity({ ...university, other: e.target.value })
                  }
                  {...universityForm.field('university')}
                />
                <FieldError {...universityForm.errorProps('university')} />
              </Field>
            )}
          </>
        )}

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
          disabled={pending}
        >
          Renunță
        </Button>
        <Button type="submit" form={FORM_ID} disabled={pending}>
          {pending ? 'Se salvează…' : 'Salvează modificările'}
        </Button>
      </FormSheetFooter>
    </>
  );
}

/**
 * **Editează profilul**: the Member's own Nickname, phone and avatar colour
 * (and, for BC and the Moderator, their Universitate), and under them the
 * request to change the sign-in address — one form sheet, whose pinned
 * **Salvează modificările** saves the profile form.
 */
export default function EditProfileSheet({
  open,
  onClose,
  profile,
  canEditUniversity,
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
          canEditUniversity={canEditUniversity}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </FormSheet>
  );
}

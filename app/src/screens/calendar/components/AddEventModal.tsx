import { useState } from 'react';
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonContent,
  IonItem,
  IonLabel,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonTextarea,
  IonDatetime,
  IonDatetimeButton,
} from '@ionic/react';
import { useCreateEventMutation } from '../../../queries/events';
import { useDepartments, useTeams } from '../../../queries/reference';

export function AddEventModal({
  isOpen,
  onDidDismiss,
}: {
  isOpen: boolean;
  onDidDismiss: () => void;
}) {
  const { mutateAsync: createEvent } = useCreateEventMutation();
  const { data: departments } = useDepartments();
  const { data: teams } = useTeams();

  const [title, setTitle] = useState('');
  const [type, setType] = useState<
    'sedinta' | 'activitate' | 'call' | 'eveniment' | 'deadline' | 'recrutare'
  >('eveniment');
  const [scope, setScope] = useState<'team' | 'dept' | 'project' | 'org'>(
    'org',
  );
  const [deptId, setDeptId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState<string>(new Date().toISOString());
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [location, setLocation] = useState('');
  const [capacity, setCapacity] = useState<number | null>(null);
  const [description, setDescription] = useState('');

  const [submitting, setSubmitting] = useState(false);

  // Derive department list
  const deptList = departments ? Array.from(departments.values()) : [];
  // Derive team list if a dept is selected, otherwise all teams
  const teamList = teams
    ? deptId
      ? teams.filter((t) => t.dept_id === deptId)
      : teams
    : [];

  const handleSave = async () => {
    if (!title.trim()) return;
    try {
      setSubmitting(true);
      await createEvent({
        title,
        type,
        scope,
        dept_id: scope === 'dept' || scope === 'team' ? deptId : null,
        team_id: scope === 'team' ? teamId : null,
        starts_at: startsAt,
        ends_at: endsAt || null,
        location: location || null,
        capacity: capacity || null,
        description: description || null,
      });
      onDidDismiss();
    } catch (err) {
      console.error(err);
      // In a real app we might show a toast here
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onDidDismiss}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Adaugă activitate</IonTitle>
          <IonButtons slot="start">
            <IonButton onClick={onDidDismiss}>Anulează</IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton
              strong
              disabled={!title.trim() || submitting}
              onClick={handleSave}
            >
              Salvează
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonItem>
          <IonInput
            label="Titlu activitate"
            labelPlacement="stacked"
            placeholder="ex. Ședință de departament"
            value={title}
            onIonInput={(e) => setTitle(e.detail.value!)}
          />
        </IonItem>

        <IonItem>
          <IonSelect
            label="Tip"
            labelPlacement="stacked"
            value={type}
            onIonChange={(e) => setType(e.detail.value)}
          >
            <IonSelectOption value="eveniment">Eveniment</IonSelectOption>
            <IonSelectOption value="sedinta">Ședință</IonSelectOption>
            <IonSelectOption value="activitate">Activitate</IonSelectOption>
            <IonSelectOption value="call">Call</IonSelectOption>
            <IonSelectOption value="deadline">Deadline</IonSelectOption>
            <IonSelectOption value="recrutare">Recrutare</IonSelectOption>
          </IonSelect>
        </IonItem>

        <IonItem>
          <IonSelect
            label="Vizibilitate (Scope)"
            labelPlacement="stacked"
            value={scope}
            onIonChange={(e) => {
              setScope(e.detail.value);
              if (e.detail.value === 'org') {
                setDeptId(null);
                setTeamId(null);
              }
            }}
          >
            <IonSelectOption value="org">Organizație (Org)</IonSelectOption>
            <IonSelectOption value="dept">Departament (Dept)</IonSelectOption>
            <IonSelectOption value="team">Echipă (Team)</IonSelectOption>
            <IonSelectOption value="project">Proiect</IonSelectOption>
          </IonSelect>
        </IonItem>

        {(scope === 'dept' || scope === 'team') && (
          <IonItem>
            <IonSelect
              label="Departament"
              labelPlacement="stacked"
              value={deptId}
              onIonChange={(e) => {
                setDeptId(e.detail.value);
                setTeamId(null); // reset team when dept changes
              }}
            >
              {deptList.map((d) => (
                <IonSelectOption key={d.id} value={d.id}>
                  {d.name}
                </IonSelectOption>
              ))}
            </IonSelect>
          </IonItem>
        )}

        {scope === 'team' && (
          <IonItem>
            <IonSelect
              label="Echipă"
              labelPlacement="stacked"
              value={teamId}
              onIonChange={(e) => setTeamId(e.detail.value)}
            >
              {teamList.map((t) => (
                <IonSelectOption key={t.id} value={t.id}>
                  {t.name}
                </IonSelectOption>
              ))}
            </IonSelect>
          </IonItem>
        )}

        <IonItem>
          <IonLabel position="stacked">Începe la</IonLabel>
          <IonDatetimeButton datetime="startsAt" />
          <IonModal keepContentsMounted={true}>
            <IonDatetime
              id="startsAt"
              value={startsAt}
              onIonChange={(e) => setStartsAt(e.detail.value as string)}
            />
          </IonModal>
        </IonItem>

        <IonItem>
          <IonLabel position="stacked">Se termină la (Opțional)</IonLabel>
          <IonDatetimeButton datetime="endsAt" />
          <IonModal keepContentsMounted={true}>
            <IonDatetime
              id="endsAt"
              value={endsAt}
              onIonChange={(e) => setEndsAt(e.detail.value as string)}
              showClearButton={true}
            />
          </IonModal>
        </IonItem>

        <IonItem>
          <IonInput
            label="Locație (Opțional)"
            labelPlacement="stacked"
            value={location}
            onIonInput={(e) => setLocation(e.detail.value!)}
          />
        </IonItem>

        <IonItem>
          <IonInput
            type="number"
            label="Capacitate (Opțional)"
            labelPlacement="stacked"
            value={capacity}
            onIonInput={(e) =>
              setCapacity(e.detail.value ? parseInt(e.detail.value) : null)
            }
          />
        </IonItem>

        <IonItem>
          <IonTextarea
            label="Descriere (Opțional)"
            labelPlacement="stacked"
            value={description}
            onIonInput={(e) => setDescription(e.detail.value!)}
          />
        </IonItem>
      </IonContent>
    </IonModal>
  );
}

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      announcement_reads: {
        Row: {
          announcement_id: number
          member_id: string
          read_at: string
        }
        Insert: {
          announcement_id: number
          member_id: string
          read_at?: string
        }
        Update: {
          announcement_id?: number
          member_id?: string
          read_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_reads_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_reads_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "announcement_reads_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "announcement_reads_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "announcement_reads_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_reads_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_reads_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          author: string | null
          body: string
          category: string | null
          created_by: string | null
          dept_id: string | null
          form_label: string | null
          form_url: string | null
          id: number
          pinned: boolean
          priority: Database["public"]["Enums"]["announce_priority"]
          published_at: string
          title: string
        }
        Insert: {
          author?: string | null
          body: string
          category?: string | null
          created_by?: string | null
          dept_id?: string | null
          form_label?: string | null
          form_url?: string | null
          id?: never
          pinned?: boolean
          priority?: Database["public"]["Enums"]["announce_priority"]
          published_at?: string
          title: string
        }
        Update: {
          author?: string | null
          body?: string
          category?: string | null
          created_by?: string | null
          dept_id?: string | null
          form_label?: string | null
          form_url?: string | null
          id?: never
          pinned?: boolean
          priority?: Database["public"]["Enums"]["announce_priority"]
          published_at?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_dept_id_fkey"
            columns: ["dept_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          created_at: string
          created_by: string
          department_id: string | null
          group_id: number
          id: number
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          department_id?: string | null
          group_id: number
          id?: never
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          department_id?: string | null
          group_id?: number
          id?: never
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      completed_work_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          dept_id: string | null
          description: string
          group_id: number
          id: number
          project_id: number | null
          requester_id: string
          status: string
          task_id: number | null
          team_id: string | null
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          dept_id?: string | null
          description: string
          group_id: number
          id?: never
          project_id?: number | null
          requester_id: string
          status?: string
          task_id?: number | null
          team_id?: string | null
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          dept_id?: string | null
          description?: string
          group_id?: number
          id?: never
          project_id?: number | null
          requester_id?: string
          status?: string
          task_id?: number | null
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "completed_work_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "completed_work_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "completed_work_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "completed_work_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completed_work_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completed_work_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completed_work_requests_dept_id_fkey"
            columns: ["dept_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completed_work_requests_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completed_work_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completed_work_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "completed_work_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "completed_work_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "completed_work_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completed_work_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completed_work_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completed_work_requests_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_queue_summary"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "completed_work_requests_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completed_work_requests_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_overdue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completed_work_requests_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          color: string
          id: string
          kind: string
          name: string
          short: string
        }
        Insert: {
          color: string
          id: string
          kind?: string
          name: string
          short: string
        }
        Update: {
          color?: string
          id?: string
          kind?: string
          name?: string
          short?: string
        }
        Relationships: []
      }
      difficulty_guide: {
        Row: {
          note: string | null
          stars: number
        }
        Insert: {
          note?: string | null
          stars: number
        }
        Update: {
          note?: string | null
          stars?: number
        }
        Relationships: []
      }
      event_attendance: {
        Row: {
          checked_in: boolean | null
          event_id: number
          member_id: string
          status: string
        }
        Insert: {
          checked_in?: boolean | null
          event_id: number
          member_id: string
          status?: string
        }
        Update: {
          checked_in?: boolean | null
          event_id?: number
          member_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_attendance_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_attendance_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "event_attendance_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "event_attendance_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "event_attendance_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_attendance_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_attendance_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          capacity: number | null
          created_at: string
          created_by: string | null
          dept_id: string | null
          description: string | null
          ends_at: string | null
          group_id: number
          has_qr: boolean | null
          id: number
          location: string | null
          min_level: number
          project_id: number | null
          scope: Database["public"]["Enums"]["event_scope"]
          starts_at: string
          team_id: string | null
          title: string
          type: Database["public"]["Enums"]["event_type"]
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          capacity?: number | null
          created_at?: string
          created_by?: string | null
          dept_id?: string | null
          description?: string | null
          ends_at?: string | null
          group_id: number
          has_qr?: boolean | null
          id?: never
          location?: string | null
          min_level?: number
          project_id?: number | null
          scope: Database["public"]["Enums"]["event_scope"]
          starts_at: string
          team_id?: string | null
          title: string
          type: Database["public"]["Enums"]["event_type"]
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          capacity?: number | null
          created_at?: string
          created_by?: string | null
          dept_id?: string | null
          description?: string | null
          ends_at?: string | null
          group_id?: number
          has_qr?: boolean | null
          id?: never
          location?: string | null
          min_level?: number
          project_id?: number | null
          scope?: Database["public"]["Enums"]["event_scope"]
          starts_at?: string
          team_id?: string | null
          title?: string
          type?: Database["public"]["Enums"]["event_type"]
        }
        Relationships: [
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_dept_id_fkey"
            columns: ["dept_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_team_department_fkey"
            columns: ["team_id", "dept_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "dept_id"]
          },
        ]
      }
      group_members: {
        Row: {
          created_at: string
          group_id: number
          group_role: string
          member_id: string
          position_title: string | null
        }
        Insert: {
          created_at?: string
          group_id: number
          group_role?: string
          member_id: string
          position_title?: string | null
        }
        Update: {
          created_at?: string
          group_id?: number
          group_role?: string
          member_id?: string
          position_title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "group_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "group_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "group_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          accepts_applications: boolean
          application_level: number | null
          automatic_membership: boolean
          category: string
          color: string | null
          competes_in_cup: boolean
          counts_toward_parent_cup: boolean
          created_at: string
          created_by: string | null
          id: number
          legacy_dept_id: string | null
          legacy_project_id: number | null
          legacy_team_id: string | null
          manager_title: string | null
          min_level: number
          name: string
          parent_id: number | null
          path: number[]
          shared_work_visibility: boolean
          short: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accepts_applications?: boolean
          application_level?: number | null
          automatic_membership?: boolean
          category: string
          color?: string | null
          competes_in_cup?: boolean
          counts_toward_parent_cup?: boolean
          created_at?: string
          created_by?: string | null
          id?: never
          legacy_dept_id?: string | null
          legacy_project_id?: number | null
          legacy_team_id?: string | null
          manager_title?: string | null
          min_level?: number
          name: string
          parent_id?: number | null
          path: number[]
          shared_work_visibility?: boolean
          short?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accepts_applications?: boolean
          application_level?: number | null
          automatic_membership?: boolean
          category?: string
          color?: string | null
          competes_in_cup?: boolean
          counts_toward_parent_cup?: boolean
          created_at?: string
          created_by?: string | null
          id?: never
          legacy_dept_id?: string | null
          legacy_project_id?: number | null
          legacy_team_id?: string | null
          manager_title?: string | null
          min_level?: number
          name?: string
          parent_id?: number | null
          path?: number[]
          shared_work_visibility?: boolean
          short?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      member_departments: {
        Row: {
          dept_id: string
          member_id: string
        }
        Insert: {
          dept_id: string
          member_id: string
        }
        Update: {
          dept_id?: string
          member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_departments_dept_id_fkey"
            columns: ["dept_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_departments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "member_departments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "member_departments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "member_departments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_departments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_departments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      notif_suppression: {
        Row: {
          kind: Database["public"]["Enums"]["noti_kind"]
          role: Database["public"]["Enums"]["member_role"]
        }
        Insert: {
          kind: Database["public"]["Enums"]["noti_kind"]
          role: Database["public"]["Enums"]["member_role"]
        }
        Update: {
          kind?: Database["public"]["Enums"]["noti_kind"]
          role?: Database["public"]["Enums"]["member_role"]
        }
        Relationships: [
          {
            foreignKeyName: "notif_suppression_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          critical: boolean
          dedupe_key: string | null
          icon: string | null
          id: number
          kind: Database["public"]["Enums"]["noti_kind"]
          link: string | null
          member_id: string
          read: boolean
          task_id: number | null
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          critical?: boolean
          dedupe_key?: string | null
          icon?: string | null
          id?: never
          kind: Database["public"]["Enums"]["noti_kind"]
          link?: string | null
          member_id: string
          read?: boolean
          task_id?: number | null
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          critical?: boolean
          dedupe_key?: string | null
          icon?: string | null
          id?: never
          kind?: Database["public"]["Enums"]["noti_kind"]
          link?: string | null
          member_id?: string
          read?: boolean
          task_id?: number | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "notifications_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "notifications_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "notifications_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_queue_summary"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_overdue"
            referencedColumns: ["id"]
          },
        ]
      }
      points_ledger: {
        Row: {
          awarded_by: string | null
          created_at: string
          delta: number
          evaluation_id: number | null
          id: number
          member_id: string
          note: string | null
          reason: string
          task_id: number | null
        }
        Insert: {
          awarded_by?: string | null
          created_at?: string
          delta: number
          evaluation_id?: number | null
          id?: never
          member_id: string
          note?: string | null
          reason: string
          task_id?: number | null
        }
        Update: {
          awarded_by?: string | null
          created_at?: string
          delta?: number
          evaluation_id?: number | null
          id?: never
          member_id?: string
          note?: string | null
          reason?: string
          task_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "points_ledger_awarded_by_fkey"
            columns: ["awarded_by"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "points_ledger_awarded_by_fkey"
            columns: ["awarded_by"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "points_ledger_awarded_by_fkey"
            columns: ["awarded_by"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "points_ledger_awarded_by_fkey"
            columns: ["awarded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_ledger_awarded_by_fkey"
            columns: ["awarded_by"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_ledger_awarded_by_fkey"
            columns: ["awarded_by"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_ledger_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "task_evaluations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_ledger_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "points_ledger_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "points_ledger_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "points_ledger_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_ledger_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_ledger_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_ledger_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_queue_summary"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "points_ledger_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_ledger_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_overdue"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_color: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          joined_at: string | null
          joined_year: number | null
          phone: string | null
          role: Database["public"]["Enums"]["member_role"]
          status: Database["public"]["Enums"]["member_status"]
          tier: string | null
        }
        Insert: {
          avatar_color?: string | null
          created_at?: string
          email: string
          full_name: string
          id: string
          joined_at?: string | null
          joined_year?: number | null
          phone?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          status?: Database["public"]["Enums"]["member_status"]
          tier?: string | null
        }
        Update: {
          avatar_color?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          joined_at?: string | null
          joined_year?: number | null
          phone?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          status?: Database["public"]["Enums"]["member_status"]
          tier?: string | null
        }
        Relationships: []
      }
      project_members: {
        Row: {
          created_at: string
          member_id: string
          project_id: number
          project_role: string
        }
        Insert: {
          created_at?: string
          member_id: string
          project_id: number
          project_role: string
        }
        Update: {
          created_at?: string
          member_id?: string
          project_id?: number
          project_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "project_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "project_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "project_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          created_by: string
          id: number
          leader_id: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: never
          leader_id: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: never
          leader_id?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "projects_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "projects_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "projects_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      push_tokens: {
        Row: {
          created_at: string
          id: string
          member_id: string
          platform: string
          token: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_id: string
          platform: string
          token: string
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string
          platform?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "push_tokens_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "push_tokens_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "push_tokens_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_tokens_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_tokens_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      rating_guide: {
        Row: {
          label: string
          multiplier: number
          note: string | null
          rating: number
        }
        Insert: {
          label: string
          multiplier: number
          note?: string | null
          rating: number
        }
        Update: {
          label?: string
          multiplier?: number
          note?: string | null
          rating?: number
        }
        Relationships: []
      }
      roles: {
        Row: {
          id: Database["public"]["Enums"]["member_role"]
          level: number
          name: string
        }
        Insert: {
          id: Database["public"]["Enums"]["member_role"]
          level: number
          name: string
        }
        Update: {
          id?: Database["public"]["Enums"]["member_role"]
          level?: number
          name?: string
        }
        Relationships: []
      }
      task_activity: {
        Row: {
          actor_id: string | null
          assignment_id: number | null
          created_at: string
          details: Json
          from_status: Database["public"]["Enums"]["task_status"] | null
          id: number
          kind: string
          note: string | null
          occurred_at: string
          task_id: number
          to_status: Database["public"]["Enums"]["task_status"] | null
        }
        Insert: {
          actor_id?: string | null
          assignment_id?: number | null
          created_at?: string
          details?: Json
          from_status?: Database["public"]["Enums"]["task_status"] | null
          id?: never
          kind: string
          note?: string | null
          occurred_at?: string
          task_id: number
          to_status?: Database["public"]["Enums"]["task_status"] | null
        }
        Update: {
          actor_id?: string | null
          assignment_id?: number | null
          created_at?: string
          details?: Json
          from_status?: Database["public"]["Enums"]["task_status"] | null
          id?: never
          kind?: string
          note?: string | null
          occurred_at?: string
          task_id?: number
          to_status?: Database["public"]["Enums"]["task_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "task_activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "task_activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "task_activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "task_activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activity_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "task_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_queue_summary"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_overdue"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          end_note: string | null
          end_reason: string | null
          ended_at: string | null
          id: number
          member_id: string
          task_id: number
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          end_note?: string | null
          end_reason?: string | null
          ended_at?: string | null
          id?: never
          member_id: string
          task_id: number
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          end_note?: string | null
          end_reason?: string | null
          ended_at?: string | null
          id?: never
          member_id?: string
          task_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "task_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "task_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "task_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "task_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "task_assignments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "task_assignments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "task_assignments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_queue_summary"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_overdue"
            referencedColumns: ["id"]
          },
        ]
      }
      task_candidates: {
        Row: {
          assignment_id: number | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: number
          joined_at: string
          member_id: string
          status: string
          task_id: number
        }
        Insert: {
          assignment_id?: number | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: never
          joined_at?: string
          member_id: string
          status?: string
          task_id: number
        }
        Update: {
          assignment_id?: number | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: never
          joined_at?: string
          member_id?: string
          status?: string
          task_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "task_candidates_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "task_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_candidates_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "task_candidates_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "task_candidates_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "task_candidates_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_candidates_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_candidates_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_candidates_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "task_candidates_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "task_candidates_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "task_candidates_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_candidates_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_candidates_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_candidates_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_queue_summary"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_candidates_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_candidates_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_overdue"
            referencedColumns: ["id"]
          },
        ]
      }
      task_evaluations: {
        Row: {
          assignment_id: number
          created_at: string
          difficulty: number
          evaluated_at: string
          evaluated_by: string | null
          id: number
          note: string
          outcome: string
          points: number
          rating: number
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          source: string
          task_id: number
        }
        Insert: {
          assignment_id: number
          created_at?: string
          difficulty: number
          evaluated_at?: string
          evaluated_by?: string | null
          id?: never
          note: string
          outcome: string
          points: number
          rating: number
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          source?: string
          task_id: number
        }
        Update: {
          assignment_id?: number
          created_at?: string
          difficulty?: number
          evaluated_at?: string
          evaluated_by?: string | null
          id?: never
          note?: string
          outcome?: string
          points?: number
          rating?: number
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          source?: string
          task_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "task_evaluations_assignment_id_task_id_fkey"
            columns: ["assignment_id", "task_id"]
            isOneToOne: false
            referencedRelation: "task_assignments"
            referencedColumns: ["id", "task_id"]
          },
          {
            foreignKeyName: "task_evaluations_evaluated_by_fkey"
            columns: ["evaluated_by"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "task_evaluations_evaluated_by_fkey"
            columns: ["evaluated_by"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "task_evaluations_evaluated_by_fkey"
            columns: ["evaluated_by"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "task_evaluations_evaluated_by_fkey"
            columns: ["evaluated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_evaluations_evaluated_by_fkey"
            columns: ["evaluated_by"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_evaluations_evaluated_by_fkey"
            columns: ["evaluated_by"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_evaluations_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "task_evaluations_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "task_evaluations_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "task_evaluations_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_evaluations_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_evaluations_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_evaluations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_queue_summary"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_evaluations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_evaluations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_overdue"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignment_mode: string | null
          audience: string | null
          campaign_id: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deadline: string | null
          dept_id: string | null
          description: string | null
          difficulty: number | null
          duplicated_from_task_id: number | null
          group_id: number
          id: number
          kind: string
          parent_task_id: number | null
          project_id: number | null
          queue_closed_at: string | null
          queue_opened_at: string | null
          rating: number | null
          returned_to_progress_at: string | null
          review_round: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          submitted_at: string | null
          team_id: string | null
          title: string
          type: string | null
          unfulfilled_at: string | null
        }
        Insert: {
          assignment_mode?: string | null
          audience?: string | null
          campaign_id?: number | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deadline?: string | null
          dept_id?: string | null
          description?: string | null
          difficulty?: number | null
          duplicated_from_task_id?: number | null
          group_id: number
          id?: never
          kind?: string
          parent_task_id?: number | null
          project_id?: number | null
          queue_closed_at?: string | null
          queue_opened_at?: string | null
          rating?: number | null
          returned_to_progress_at?: string | null
          review_round?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          submitted_at?: string | null
          team_id?: string | null
          title: string
          type?: string | null
          unfulfilled_at?: string | null
        }
        Update: {
          assignment_mode?: string | null
          audience?: string | null
          campaign_id?: number | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deadline?: string | null
          dept_id?: string | null
          description?: string | null
          difficulty?: number | null
          duplicated_from_task_id?: number | null
          group_id?: number
          id?: never
          kind?: string
          parent_task_id?: number | null
          project_id?: number | null
          queue_closed_at?: string | null
          queue_opened_at?: string | null
          rating?: number | null
          returned_to_progress_at?: string | null
          review_round?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          submitted_at?: string | null
          team_id?: string | null
          title?: string
          type?: string | null
          unfulfilled_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_dept_id_fkey"
            columns: ["dept_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_duplicated_from_task_id_fkey"
            columns: ["duplicated_from_task_id"]
            isOneToOne: false
            referencedRelation: "task_queue_summary"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "tasks_duplicated_from_task_id_fkey"
            columns: ["duplicated_from_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_duplicated_from_task_id_fkey"
            columns: ["duplicated_from_task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_overdue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "task_queue_summary"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_overdue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          member_id: string
          team_id: string
        }
        Insert: {
          member_id: string
          team_id: string
        }
        Update: {
          member_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "team_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "team_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "team_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          dept_id: string | null
          id: string
          is_interne: boolean
          name: string
        }
        Insert: {
          dept_id?: string | null
          id: string
          is_interne?: boolean
          name: string
        }
        Update: {
          dept_id?: string | null
          id?: string
          is_interne?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_dept_id_fkey"
            columns: ["dept_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      dept_cup: {
        Row: {
          dept_id: string | null
          members: number | null
          name: string | null
          points: number | null
        }
        Relationships: []
      }
      leaderboard: {
        Row: {
          full_name: string | null
          member_id: string | null
          points: number | null
          rank: number | null
          role: Database["public"]["Enums"]["member_role"] | null
        }
        Relationships: []
      }
      member_points: {
        Row: {
          member_id: string | null
          points: number | null
        }
        Relationships: []
      }
      my_points: {
        Row: {
          member_id: string | null
          points: number | null
        }
        Relationships: []
      }
      profiles_contact: {
        Row: {
          email: string | null
          id: string | null
          phone: string | null
        }
        Insert: {
          email?: string | null
          id?: string | null
          phone?: string | null
        }
        Update: {
          email?: string | null
          id?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      profiles_directory: {
        Row: {
          avatar_color: string | null
          created_at: string | null
          full_name: string | null
          id: string | null
          joined_at: string | null
          joined_year: number | null
          role: Database["public"]["Enums"]["member_role"] | null
          status: Database["public"]["Enums"]["member_status"] | null
          tier: string | null
        }
        Insert: {
          avatar_color?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string | null
          joined_at?: string | null
          joined_year?: number | null
          role?: Database["public"]["Enums"]["member_role"] | null
          status?: Database["public"]["Enums"]["member_status"] | null
          tier?: string | null
        }
        Update: {
          avatar_color?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string | null
          joined_at?: string | null
          joined_year?: number | null
          role?: Database["public"]["Enums"]["member_role"] | null
          status?: Database["public"]["Enums"]["member_status"] | null
          tier?: string | null
        }
        Relationships: []
      }
      task_queue_summary: {
        Row: {
          my_position: number | null
          pending_count: number | null
          task_id: number | null
        }
        Insert: {
          my_position?: never
          pending_count?: never
          task_id?: number | null
        }
        Update: {
          my_position?: never
          pending_count?: never
          task_id?: number | null
        }
        Relationships: []
      }
      tasks_with_overdue: {
        Row: {
          assignment_mode: string | null
          audience: string | null
          campaign_id: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          deadline: string | null
          dept_id: string | null
          description: string | null
          difficulty: number | null
          duplicated_from_task_id: number | null
          group_id: number | null
          id: number | null
          is_overdue: boolean | null
          kind: string | null
          parent_task_id: number | null
          project_id: number | null
          queue_closed_at: string | null
          queue_opened_at: string | null
          rating: number | null
          returned_to_progress_at: string | null
          review_round: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"] | null
          submitted_at: string | null
          team_id: string | null
          title: string | null
          type: string | null
          unfulfilled_at: string | null
        }
        Insert: {
          assignment_mode?: string | null
          audience?: string | null
          campaign_id?: number | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          deadline?: string | null
          dept_id?: string | null
          description?: string | null
          difficulty?: number | null
          duplicated_from_task_id?: number | null
          group_id?: number | null
          id?: number | null
          is_overdue?: never
          kind?: string | null
          parent_task_id?: number | null
          project_id?: number | null
          queue_closed_at?: string | null
          queue_opened_at?: string | null
          rating?: number | null
          returned_to_progress_at?: string | null
          review_round?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"] | null
          submitted_at?: string | null
          team_id?: string | null
          title?: string | null
          type?: string | null
          unfulfilled_at?: string | null
        }
        Update: {
          assignment_mode?: string | null
          audience?: string | null
          campaign_id?: number | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          deadline?: string | null
          dept_id?: string | null
          description?: string | null
          difficulty?: number | null
          duplicated_from_task_id?: number | null
          group_id?: number | null
          id?: number | null
          is_overdue?: never
          kind?: string | null
          parent_task_id?: number | null
          project_id?: number | null
          queue_closed_at?: string | null
          queue_opened_at?: string | null
          rating?: number | null
          returned_to_progress_at?: string | null
          review_round?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"] | null
          submitted_at?: string | null
          team_id?: string | null
          title?: string | null
          type?: string | null
          unfulfilled_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "leaderboard"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "member_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "my_points"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_dept_id_fkey"
            columns: ["dept_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_duplicated_from_task_id_fkey"
            columns: ["duplicated_from_task_id"]
            isOneToOne: false
            referencedRelation: "task_queue_summary"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "tasks_duplicated_from_task_id_fkey"
            columns: ["duplicated_from_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_duplicated_from_task_id_fkey"
            columns: ["duplicated_from_task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_overdue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "task_queue_summary"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks_with_overdue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      add_department_team_member: {
        Args: { p_member_id: string; p_team_id: string }
        Returns: {
          member_id: string
          team_id: string
        }
        SetofOptions: {
          from: "*"
          to: "team_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_independent_team_member: {
        Args: { p_member_id: string; p_team_id: string }
        Returns: {
          member_id: string
          team_id: string
        }
        SetofOptions: {
          from: "*"
          to: "team_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_project_member: {
        Args: { p_member_id: string; p_project_id: number }
        Returns: {
          created_at: string
          member_id: string
          project_id: number
          project_role: string
        }
        SetofOptions: {
          from: "*"
          to: "project_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_completed_work_request: {
        Args: {
          p_difficulty: number
          p_note: string
          p_rating: number
          p_request_id: number
        }
        Returns: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          dept_id: string | null
          description: string
          group_id: number
          id: number
          project_id: number | null
          requester_id: string
          status: string
          task_id: number | null
          team_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "completed_work_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_project: {
        Args: { p_project_id: number }
        Returns: {
          created_at: string
          created_by: string
          id: number
          leader_id: string
          name: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_task_executor: {
        Args: { p_member_id: string; p_task_id: number }
        Returns: {
          assignment_mode: string | null
          audience: string | null
          campaign_id: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deadline: string | null
          dept_id: string | null
          description: string | null
          difficulty: number | null
          duplicated_from_task_id: number | null
          group_id: number
          id: number
          kind: string
          parent_task_id: number | null
          project_id: number | null
          queue_closed_at: string | null
          queue_opened_at: string | null
          rating: number | null
          returned_to_progress_at: string | null
          review_round: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          submitted_at: string | null
          team_id: string | null
          title: string
          type: string | null
          unfulfilled_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      auth_in_dept: { Args: { d: string }; Returns: boolean }
      auth_in_group: { Args: { g: number }; Returns: boolean }
      auth_in_team: { Args: { t: string }; Returns: boolean }
      auth_is_member: { Args: never; Returns: boolean }
      auth_level: { Args: never; Returns: number }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["member_role"]
      }
      can_manage_tasks: { Args: never; Returns: boolean }
      can_read_all_tasks: { Args: never; Returns: boolean }
      cancel_task: {
        Args: { p_reason: string; p_task_id: number }
        Returns: {
          assignment_mode: string | null
          audience: string | null
          campaign_id: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deadline: string | null
          dept_id: string | null
          description: string | null
          difficulty: number | null
          duplicated_from_task_id: number | null
          group_id: number
          id: number
          kind: string
          parent_task_id: number | null
          project_id: number | null
          queue_closed_at: string | null
          queue_opened_at: string | null
          rating: number | null
          returned_to_progress_at: string | null
          review_round: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          submitted_at: string | null
          team_id: string | null
          title: string
          type: string | null
          unfulfilled_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_task_review: {
        Args: {
          p_difficulty: number
          p_note: string
          p_rating: number
          p_task_id: number
        }
        Returns: {
          assignment_mode: string | null
          audience: string | null
          campaign_id: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deadline: string | null
          dept_id: string | null
          description: string | null
          difficulty: number | null
          duplicated_from_task_id: number | null
          group_id: number
          id: number
          kind: string
          parent_task_id: number | null
          project_id: number | null
          queue_closed_at: string | null
          queue_opened_at: string | null
          rating: number | null
          returned_to_progress_at: string | null
          review_round: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          submitted_at: string | null
          team_id: string | null
          title: string
          type: string | null
          unfulfilled_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_umbrella_task: {
        Args: { p_task_id: number }
        Returns: {
          assignment_mode: string | null
          audience: string | null
          campaign_id: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deadline: string | null
          dept_id: string | null
          description: string | null
          difficulty: number | null
          duplicated_from_task_id: number | null
          group_id: number
          id: number
          kind: string
          parent_task_id: number | null
          project_id: number | null
          queue_closed_at: string | null
          queue_opened_at: string | null
          rating: number | null
          returned_to_progress_at: string | null
          review_round: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          submitted_at: string | null
          team_id: string | null
          title: string
          type: string | null
          unfulfilled_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      convert_task_mode: {
        Args: {
          p_assignment_mode: string
          p_audience: string
          p_task_id: number
        }
        Returns: {
          assignment_mode: string | null
          audience: string | null
          campaign_id: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deadline: string | null
          dept_id: string | null
          description: string | null
          difficulty: number | null
          duplicated_from_task_id: number | null
          group_id: number
          id: number
          kind: string
          parent_task_id: number | null
          project_id: number | null
          queue_closed_at: string | null
          queue_opened_at: string | null
          rating: number | null
          returned_to_progress_at: string | null
          review_round: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          submitted_at: string | null
          team_id: string | null
          title: string
          type: string | null
          unfulfilled_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_campaign:
        | {
            Args: { p_department_id: string; p_name: string }
            Returns: {
              created_at: string
              created_by: string
              department_id: string | null
              group_id: number
              id: number
              is_active: boolean
              name: string
              updated_at: string
            }
            SetofOptions: {
              from: "*"
              to: "campaigns"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { p_group_id: number; p_name: string }
            Returns: {
              created_at: string
              created_by: string
              department_id: string | null
              group_id: number
              id: number
              is_active: boolean
              name: string
              updated_at: string
            }
            SetofOptions: {
              from: "*"
              to: "campaigns"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      create_completed_work_request: {
        Args: {
          p_dept_id: string
          p_description: string
          p_group_id?: number
          p_project_id: number
          p_team_id: string
        }
        Returns: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          dept_id: string | null
          description: string
          group_id: number
          id: number
          project_id: number | null
          requester_id: string
          status: string
          task_id: number | null
          team_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "completed_work_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_event: {
        Args: {
          p_capacity?: number
          p_dept_id?: string
          p_description?: string
          p_ends_at?: string
          p_location?: string
          p_scope: string
          p_starts_at: string
          p_team_id?: string
          p_title: string
          p_type: string
        }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          capacity: number | null
          created_at: string
          created_by: string | null
          dept_id: string | null
          description: string | null
          ends_at: string | null
          group_id: number
          has_qr: boolean | null
          id: number
          location: string | null
          min_level: number
          project_id: number | null
          scope: Database["public"]["Enums"]["event_scope"]
          starts_at: string
          team_id: string | null
          title: string
          type: Database["public"]["Enums"]["event_type"]
        }
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_project: {
        Args: { p_leader_id: string; p_name: string }
        Returns: {
          created_at: string
          created_by: string
          id: number
          leader_id: string
          name: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_task: {
        Args: {
          p_assignment_mode: string
          p_audience: string
          p_campaign_id?: number
          p_deadline: string
          p_dept_id: string
          p_description: string
          p_executor_id?: string
          p_group_id?: number
          p_kind?: string
          p_parent_task_id?: number
          p_project_id: number
          p_team_id: string
          p_title: string
        }
        Returns: {
          assignment_mode: string | null
          audience: string | null
          campaign_id: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deadline: string | null
          dept_id: string | null
          description: string | null
          difficulty: number | null
          duplicated_from_task_id: number | null
          group_id: number
          id: number
          kind: string
          parent_task_id: number | null
          project_id: number | null
          queue_closed_at: string | null
          queue_opened_at: string | null
          rating: number | null
          returned_to_progress_at: string | null
          review_round: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          submitted_at: string | null
          team_id: string | null
          title: string
          type: string | null
          unfulfilled_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      department_cup: {
        Args: { p_campaign_id?: number }
        Returns: {
          dept_id: string
          members: number
          name: string
          points: number
        }[]
      }
      duplicate_task: {
        Args: { p_deadline: string; p_task_id: number }
        Returns: {
          assignment_mode: string | null
          audience: string | null
          campaign_id: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deadline: string | null
          dept_id: string | null
          description: string | null
          difficulty: number | null
          duplicated_from_task_id: number | null
          group_id: number
          id: number
          kind: string
          parent_task_id: number | null
          project_id: number | null
          queue_closed_at: string | null
          queue_opened_at: string | null
          rating: number | null
          returned_to_progress_at: string | null
          review_round: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          submitted_at: string | null
          team_id: string | null
          title: string
          type: string | null
          unfulfilled_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      express_task_interest: {
        Args: { p_task_id: number }
        Returns: {
          assignment_mode: string | null
          audience: string | null
          campaign_id: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deadline: string | null
          dept_id: string | null
          description: string | null
          difficulty: number | null
          duplicated_from_task_id: number | null
          group_id: number
          id: number
          kind: string
          parent_task_id: number | null
          project_id: number | null
          queue_closed_at: string | null
          queue_opened_at: string | null
          rating: number | null
          returned_to_progress_at: string | null
          review_round: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          submitted_at: string | null
          team_id: string | null
          title: string
          type: string | null
          unfulfilled_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      give_up_task: {
        Args: { p_reason: string; p_task_id: number }
        Returns: {
          assignment_mode: string | null
          audience: string | null
          campaign_id: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deadline: string | null
          dept_id: string | null
          description: string | null
          difficulty: number | null
          duplicated_from_task_id: number | null
          group_id: number
          id: number
          kind: string
          parent_task_id: number | null
          project_id: number | null
          queue_closed_at: string | null
          queue_opened_at: string | null
          rating: number | null
          returned_to_progress_at: string | null
          review_round: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          submitted_at: string | null
          team_id: string | null
          title: string
          type: string | null
          unfulfilled_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      grant_project_responsible: {
        Args: { p_member_id: string; p_project_id: number }
        Returns: {
          created_at: string
          member_id: string
          project_id: number
          project_role: string
        }
        SetofOptions: {
          from: "*"
          to: "project_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      leadership_leaderboard: {
        Args: {
          p_campaign_id?: number
          p_department_id?: string
          p_project_id?: number
          p_team_id?: string
        }
        Returns: {
          full_name: string
          member_id: string
          points: number
          rank: number
        }[]
      }
      leadership_member_tasks: {
        Args: { p_member_id: string }
        Returns: {
          assigned_at: string
          assigned_by: string
          assignment_end_note: string
          assignment_end_reason: string
          assignment_ended_at: string
          assignment_id: number
          assignment_mode: string
          audience: string
          campaign_id: number
          campaign_name: string
          cancel_reason: string
          cancelled_at: string
          completed_at: string
          completed_late: boolean
          deadline: string
          description: string
          difficulty: number
          duplicated_from_task_id: number
          evaluation_history: Json
          is_overdue: boolean
          member_id: string
          origin_id: string
          origin_name: string
          origin_type: string
          parent_task_id: number
          parent_task_title: string
          queue_closed_at: string
          queue_opened_at: string
          rating: number
          returned_to_progress_at: string
          review_round: number
          started_at: string
          status: Database["public"]["Enums"]["task_status"]
          submitted_at: string
          subtasks: Json
          task_created_at: string
          task_created_by: string
          task_id: number
          task_kind: string
          title: string
          unfulfilled_at: string
        }[]
      }
      mark_task_unfulfilled: {
        Args: {
          p_difficulty: number
          p_note: string
          p_rating: number
          p_task_id: number
        }
        Returns: {
          assignment_mode: string | null
          audience: string | null
          campaign_id: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deadline: string | null
          dept_id: string | null
          description: string | null
          difficulty: number | null
          duplicated_from_task_id: number | null
          group_id: number
          id: number
          kind: string
          parent_task_id: number | null
          project_id: number | null
          queue_closed_at: string | null
          queue_opened_at: string | null
          rating: number | null
          returned_to_progress_at: string | null
          review_round: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          submitted_at: string | null
          team_id: string | null
          title: string
          type: string | null
          unfulfilled_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      member_level: { Args: { p_member: string }; Returns: number }
      my_managed_task_ids: {
        Args: never
        Returns: {
          task_id: number
        }[]
      }
      provision_profile: {
        Args: {
          p_dept_ids?: string[]
          p_email: string
          p_full_name: string
          p_role?: Database["public"]["Enums"]["member_role"]
          p_team_ids?: string[]
          p_user_id: string
        }
        Returns: string
      }
      rating_mult: { Args: { r: number }; Returns: number }
      reject_completed_work_request: {
        Args: { p_note: string; p_request_id: number }
        Returns: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          dept_id: string | null
          description: string
          group_id: number
          id: number
          project_id: number | null
          requester_id: string
          status: string
          task_id: number | null
          team_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "completed_work_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_department_team_member: {
        Args: { p_member_id: string; p_team_id: string }
        Returns: boolean
      }
      remove_independent_team_member: {
        Args: { p_member_id: string; p_team_id: string }
        Returns: boolean
      }
      remove_project_member: {
        Args: { p_member_id: string; p_project_id: number }
        Returns: boolean
      }
      reopen_task: {
        Args: { p_reason: string; p_task_id: number }
        Returns: {
          assignment_mode: string | null
          audience: string | null
          campaign_id: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deadline: string | null
          dept_id: string | null
          description: string | null
          difficulty: number | null
          duplicated_from_task_id: number | null
          group_id: number
          id: number
          kind: string
          parent_task_id: number | null
          project_id: number | null
          queue_closed_at: string | null
          queue_opened_at: string | null
          rating: number | null
          returned_to_progress_at: string | null
          review_round: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          submitted_at: string | null
          team_id: string | null
          title: string
          type: string | null
          unfulfilled_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      return_task_to_progress: {
        Args: { p_note: string; p_task_id: number }
        Returns: {
          assignment_mode: string | null
          audience: string | null
          campaign_id: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deadline: string | null
          dept_id: string | null
          description: string | null
          difficulty: number | null
          duplicated_from_task_id: number | null
          group_id: number
          id: number
          kind: string
          parent_task_id: number | null
          project_id: number | null
          queue_closed_at: string | null
          queue_opened_at: string | null
          rating: number | null
          returned_to_progress_at: string | null
          review_round: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          submitted_at: string | null
          team_id: string | null
          title: string
          type: string | null
          unfulfilled_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_project_responsible: {
        Args: { p_member_id: string; p_project_id: number }
        Returns: {
          created_at: string
          member_id: string
          project_id: number
          project_role: string
        }
        SetofOptions: {
          from: "*"
          to: "project_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      select_task_candidate: {
        Args: {
          p_candidate_id: number
          p_close_remaining: boolean
          p_task_id: number
        }
        Returns: {
          assignment_mode: string | null
          audience: string | null
          campaign_id: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deadline: string | null
          dept_id: string | null
          description: string | null
          difficulty: number | null
          duplicated_from_task_id: number | null
          group_id: number
          id: number
          kind: string
          parent_task_id: number | null
          project_id: number | null
          queue_closed_at: string | null
          queue_opened_at: string | null
          rating: number | null
          returned_to_progress_at: string | null
          review_round: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          submitted_at: string | null
          team_id: string | null
          title: string
          type: string | null
          unfulfilled_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_campaign_active: {
        Args: { p_active: boolean; p_campaign_id: number }
        Returns: {
          created_at: string
          created_by: string
          department_id: string | null
          group_id: number
          id: number
          is_active: boolean
          name: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "campaigns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_event_rsvp: {
        Args: { p_event_id: number; p_status: string }
        Returns: {
          checked_in: boolean | null
          event_id: number
          member_id: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "event_attendance"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_task_queue: {
        Args: { p_open: boolean; p_task_id: number }
        Returns: {
          assignment_mode: string | null
          audience: string | null
          campaign_id: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deadline: string | null
          dept_id: string | null
          description: string | null
          difficulty: number | null
          duplicated_from_task_id: number | null
          group_id: number
          id: number
          kind: string
          parent_task_id: number | null
          project_id: number | null
          queue_closed_at: string | null
          queue_opened_at: string | null
          rating: number | null
          returned_to_progress_at: string | null
          review_round: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          submitted_at: string | null
          team_id: string | null
          title: string
          type: string | null
          unfulfilled_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_task: {
        Args: { p_task_id: number }
        Returns: {
          assignment_mode: string | null
          audience: string | null
          campaign_id: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deadline: string | null
          dept_id: string | null
          description: string | null
          difficulty: number | null
          duplicated_from_task_id: number | null
          group_id: number
          id: number
          kind: string
          parent_task_id: number | null
          project_id: number | null
          queue_closed_at: string | null
          queue_opened_at: string | null
          rating: number | null
          returned_to_progress_at: string | null
          review_round: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          submitted_at: string | null
          team_id: string | null
          title: string
          type: string | null
          unfulfilled_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_task_for_review: {
        Args: { p_task_id: number }
        Returns: {
          assignment_mode: string | null
          audience: string | null
          campaign_id: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deadline: string | null
          dept_id: string | null
          description: string | null
          difficulty: number | null
          duplicated_from_task_id: number | null
          group_id: number
          id: number
          kind: string
          parent_task_id: number | null
          project_id: number | null
          queue_closed_at: string | null
          queue_opened_at: string | null
          rating: number | null
          returned_to_progress_at: string | null
          review_round: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          submitted_at: string | null
          team_id: string | null
          title: string
          type: string | null
          unfulfilled_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_campaign: {
        Args: { p_campaign_id: number; p_name: string }
        Returns: {
          created_at: string
          created_by: string
          department_id: string | null
          group_id: number
          id: number
          is_active: boolean
          name: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "campaigns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_task_content: {
        Args: {
          p_campaign_id: number
          p_deadline: string
          p_description: string
          p_task_id: number
          p_title: string
        }
        Returns: {
          assignment_mode: string | null
          audience: string | null
          campaign_id: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deadline: string | null
          dept_id: string | null
          description: string | null
          difficulty: number | null
          duplicated_from_task_id: number | null
          group_id: number
          id: number
          kind: string
          parent_task_id: number | null
          project_id: number | null
          queue_closed_at: string | null
          queue_opened_at: string | null
          rating: number | null
          returned_to_progress_at: string | null
          review_round: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          submitted_at: string | null
          team_id: string | null
          title: string
          type: string | null
          unfulfilled_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      visible_task_executors: {
        Args: { p_task_ids: number[] }
        Returns: {
          full_name: string
          member_id: string
          task_id: number
        }[]
      }
      withdraw_task_interest: {
        Args: { p_task_id: number }
        Returns: {
          assignment_mode: string | null
          audience: string | null
          campaign_id: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deadline: string | null
          dept_id: string | null
          description: string | null
          difficulty: number | null
          duplicated_from_task_id: number | null
          group_id: number
          id: number
          kind: string
          parent_task_id: number | null
          project_id: number | null
          queue_closed_at: string | null
          queue_opened_at: string | null
          rating: number | null
          returned_to_progress_at: string | null
          review_round: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          submitted_at: string | null
          team_id: string | null
          title: string
          type: string | null
          unfulfilled_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      announce_priority: "critical" | "important" | "normal"
      event_scope: "team" | "dept" | "project" | "org"
      event_type:
        | "sedinta"
        | "activitate"
        | "call"
        | "eveniment"
        | "deadline"
        | "recrutare"
      member_role:
        | "recrut"
        | "voluntar"
        | "activ"
        | "vot"
        | "responsabil"
        | "bce"
        | "bc"
        | "moderator"
      member_status: "activ" | "inactiv" | "alumni"
      noti_kind: "announce" | "deadline" | "event" | "task" | "system"
      task_status:
        | "todo"
        | "in_progress"
        | "in_review"
        | "completed"
        | "unfulfilled"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      announce_priority: ["critical", "important", "normal"],
      event_scope: ["team", "dept", "project", "org"],
      event_type: [
        "sedinta",
        "activitate",
        "call",
        "eveniment",
        "deadline",
        "recrutare",
      ],
      member_role: [
        "recrut",
        "voluntar",
        "activ",
        "vot",
        "responsabil",
        "bce",
        "bc",
        "moderator",
      ],
      member_status: ["activ", "inactiv", "alumni"],
      noti_kind: ["announce", "deadline", "event", "task", "system"],
      task_status: [
        "todo",
        "in_progress",
        "in_review",
        "completed",
        "unfulfilled",
        "cancelled",
      ],
    },
  },
} as const


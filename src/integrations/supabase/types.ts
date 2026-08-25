export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ac_esteira_state: {
        Row: {
          company_id: string
          last_assigned_ac_id: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          last_assigned_ac_id?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          last_assigned_ac_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ac_esteira_state_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ac_esteira_state_last_assigned_ac_id_fkey"
            columns: ["last_assigned_ac_id"]
            isOneToOne: false
            referencedRelation: "acs"
            referencedColumns: ["id"]
          },
        ]
      }
      acs: {
        Row: {
          active: boolean
          company_id: string
          created_at: string
          id: string
          meta_1: number | null
          meta_2: number | null
          meta_3: number | null
          name: string
          photo: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          company_id?: string
          created_at?: string
          id?: string
          meta_1?: number | null
          meta_2?: number | null
          meta_3?: number | null
          name: string
          photo?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          company_id?: string
          created_at?: string
          id?: string
          meta_1?: number | null
          meta_2?: number | null
          meta_3?: number | null
          name?: string
          photo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "acs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_logs: {
        Row: {
          action: string
          actor_name: string | null
          actor_user_id: string | null
          company_id: string | null
          created_at: string
          entity: string
          entity_id: string | null
          entity_label: string | null
          id: string
          meta: Json | null
          summary: string
        }
        Insert: {
          action: string
          actor_name?: string | null
          actor_user_id?: string | null
          company_id?: string | null
          created_at?: string
          entity: string
          entity_id?: string | null
          entity_label?: string | null
          id?: string
          meta?: Json | null
          summary: string
        }
        Update: {
          action?: string
          actor_name?: string | null
          actor_user_id?: string | null
          company_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          entity_label?: string | null
          id?: string
          meta?: Json | null
          summary?: string
        }
        Relationships: []
      }
      antecipacao_items: {
        Row: {
          ac_id: string
          company_id: string
          created_at: string
          data_vencimento: string
          id: string
          nome: string
          origem: string
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          ac_id: string
          company_id?: string
          created_at?: string
          data_vencimento: string
          id?: string
          nome: string
          origem: string
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          ac_id?: string
          company_id?: string
          created_at?: string
          data_vencimento?: string
          id?: string
          nome?: string
          origem?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "antecipacao_items_ac_id_fkey"
            columns: ["ac_id"]
            isOneToOne: false
            referencedRelation: "acs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "antecipacao_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      app_users: {
        Row: {
          ac_id: string | null
          auth_user_id: string | null
          company_id: string
          created_at: string
          id: string
          login: string
          name: string
          permissions: Json | null
          photo: string | null
          role: string
          updated_at: string
        }
        Insert: {
          ac_id?: string | null
          auth_user_id?: string | null
          company_id?: string
          created_at?: string
          id?: string
          login: string
          name: string
          permissions?: Json | null
          photo?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          ac_id?: string | null
          auth_user_id?: string | null
          company_id?: string
          created_at?: string
          id?: string
          login?: string
          name?: string
          permissions?: Json | null
          photo?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_users_ac_id_fkey"
            columns: ["ac_id"]
            isOneToOne: false
            referencedRelation: "acs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_users_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      cancellation_cases: {
        Row: {
          ac: string | null
          acao: string | null
          cancellation_fine_value: number | null
          cancellation_reviewed_installments: Json | null
          case_notes: Json
          com_30_dias_antecedencia: boolean | null
          company_id: string
          contract_pdf_url: string | null
          created_at: string
          data_evento: string | null
          dentro_7_dias: boolean | null
          descricao_cancelamento: string | null
          external_import: boolean
          final_checklist: Json | null
          funnel_stage: string | null
          history: Json
          id: string
          inscricoes_revertidas: number
          is_mirror: boolean
          ligacao_agendada_at: string | null
          motivo_cancelamento: string | null
          moved_to_current_stage_at: string
          multa_percent: number | null
          multa_value: number | null
          notes: string | null
          operational_status: string
          pagamento_tipo: string | null
          quantidade_inscricoes: number | null
          refund_plan: Json | null
          responsavel: string | null
          stage: string
          student_id: string | null
          student_name: string
          student_whatsapp: string | null
          tags: Json
          term_attachments: Json | null
          term_signed_at: string | null
          term_signed_by_student: boolean | null
          term_template: string | null
          total_pago_ate_momento: number | null
          treinamento: string | null
          updated_at: string
          value: number | null
        }
        Insert: {
          ac?: string | null
          acao?: string | null
          cancellation_fine_value?: number | null
          cancellation_reviewed_installments?: Json | null
          case_notes?: Json
          com_30_dias_antecedencia?: boolean | null
          company_id?: string
          contract_pdf_url?: string | null
          created_at?: string
          data_evento?: string | null
          dentro_7_dias?: boolean | null
          descricao_cancelamento?: string | null
          external_import?: boolean
          final_checklist?: Json | null
          funnel_stage?: string | null
          history?: Json
          id?: string
          inscricoes_revertidas?: number
          is_mirror?: boolean
          ligacao_agendada_at?: string | null
          motivo_cancelamento?: string | null
          moved_to_current_stage_at?: string
          multa_percent?: number | null
          multa_value?: number | null
          notes?: string | null
          operational_status: string
          pagamento_tipo?: string | null
          quantidade_inscricoes?: number | null
          refund_plan?: Json | null
          responsavel?: string | null
          stage: string
          student_id?: string | null
          student_name: string
          student_whatsapp?: string | null
          tags?: Json
          term_attachments?: Json | null
          term_signed_at?: string | null
          term_signed_by_student?: boolean | null
          term_template?: string | null
          total_pago_ate_momento?: number | null
          treinamento?: string | null
          updated_at?: string
          value?: number | null
        }
        Update: {
          ac?: string | null
          acao?: string | null
          cancellation_fine_value?: number | null
          cancellation_reviewed_installments?: Json | null
          case_notes?: Json
          com_30_dias_antecedencia?: boolean | null
          company_id?: string
          contract_pdf_url?: string | null
          created_at?: string
          data_evento?: string | null
          dentro_7_dias?: boolean | null
          descricao_cancelamento?: string | null
          external_import?: boolean
          final_checklist?: Json | null
          funnel_stage?: string | null
          history?: Json
          id?: string
          inscricoes_revertidas?: number
          is_mirror?: boolean
          ligacao_agendada_at?: string | null
          motivo_cancelamento?: string | null
          moved_to_current_stage_at?: string
          multa_percent?: number | null
          multa_value?: number | null
          notes?: string | null
          operational_status?: string
          pagamento_tipo?: string | null
          quantidade_inscricoes?: number | null
          refund_plan?: Json | null
          responsavel?: string | null
          stage?: string
          student_id?: string | null
          student_name?: string
          student_whatsapp?: string | null
          tags?: Json
          term_attachments?: Json | null
          term_signed_at?: string | null
          term_signed_by_student?: boolean | null
          term_template?: string | null
          total_pago_ate_momento?: number | null
          treinamento?: string | null
          updated_at?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cancellation_cases_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_rates: {
        Row: {
          boleto: number
          cartao: number
          company_id: string
          created_at: string
          pix: number
          updated_at: string
        }
        Insert: {
          boleto?: number
          cartao?: number
          company_id: string
          created_at?: string
          pix?: number
          updated_at?: string
        }
        Update: {
          boleto?: number
          cartao?: number
          company_id?: string
          created_at?: string
          pix?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_rates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      commissions: {
        Row: {
          ac_id: string | null
          ac_name: string | null
          cancellation_case_id: string
          company_id: string
          created_at: string
          id: string
          observacao: string | null
          paid_at: string | null
          payment_type: string
          pending_approval: boolean
          percent: number
          product: string | null
          reverted_value: number
          status: string
          student_id: string | null
          student_name: string
          updated_at: string
          value: number
        }
        Insert: {
          ac_id?: string | null
          ac_name?: string | null
          cancellation_case_id: string
          company_id: string
          created_at?: string
          id?: string
          observacao?: string | null
          paid_at?: string | null
          payment_type?: string
          pending_approval?: boolean
          percent?: number
          product?: string | null
          reverted_value?: number
          status?: string
          student_id?: string | null
          student_name: string
          updated_at?: string
          value?: number
        }
        Update: {
          ac_id?: string | null
          ac_name?: string | null
          cancellation_case_id?: string
          company_id?: string
          created_at?: string
          id?: string
          observacao?: string | null
          paid_at?: string | null
          payment_type?: string
          pending_approval?: boolean
          percent?: number
          product?: string | null
          reverted_value?: number
          status?: string
          student_id?: string | null
          student_name?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "commissions_ac_id_fkey"
            columns: ["ac_id"]
            isOneToOne: false
            referencedRelation: "acs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          active: boolean
          color_accent: string
          color_primary: string
          created_at: string
          id: string
          logo_url: string | null
          name: string
          slug: string
          subtitle: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          color_accent?: string
          color_primary?: string
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          slug: string
          subtitle?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          color_accent?: string
          color_primary?: string
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string
          subtitle?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      conciliacao_import_errors: {
        Row: {
          batch_id: string
          company_id: string
          created_at: string
          data_pagamento: string | null
          file_name: string | null
          id: string
          motivo: string
          raw: Json
          resolvido_at: string | null
          resolvido_nota: string | null
          resolvido_por_id: string | null
          resolvido_por_nome: string | null
          row_index: number | null
          status: string
          student_id: string | null
          student_name: string
          updated_at: string
          valor: number | null
          vencimento: string | null
        }
        Insert: {
          batch_id: string
          company_id?: string
          created_at?: string
          data_pagamento?: string | null
          file_name?: string | null
          id?: string
          motivo: string
          raw?: Json
          resolvido_at?: string | null
          resolvido_nota?: string | null
          resolvido_por_id?: string | null
          resolvido_por_nome?: string | null
          row_index?: number | null
          status?: string
          student_id?: string | null
          student_name: string
          updated_at?: string
          valor?: number | null
          vencimento?: string | null
        }
        Update: {
          batch_id?: string
          company_id?: string
          created_at?: string
          data_pagamento?: string | null
          file_name?: string | null
          id?: string
          motivo?: string
          raw?: Json
          resolvido_at?: string | null
          resolvido_nota?: string | null
          resolvido_por_id?: string | null
          resolvido_por_nome?: string | null
          row_index?: number | null
          status?: string
          student_id?: string | null
          student_name?: string
          updated_at?: string
          valor?: number | null
          vencimento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conciliacao_import_errors_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      conciliacao_items: {
        Row: {
          ac: string | null
          antes: Json
          aprovado_at: string | null
          aprovado_nota: string | null
          aprovado_por_id: string | null
          aprovado_por_nome: string | null
          autor_id: string | null
          autor_nome: string | null
          autor_observacao: string | null
          company_id: string
          conciliado_at: string | null
          conciliado_nota: string | null
          conciliado_por_id: string | null
          conciliado_por_nome: string | null
          created_at: string
          depois: Json
          id: string
          related_case_id: string | null
          reprovado_at: string | null
          reprovado_motivo: string | null
          reprovado_por_id: string | null
          reprovado_por_nome: string | null
          resumo: string
          status: string
          student_id: string | null
          student_name: string
          tipo: string
          updated_at: string
        }
        Insert: {
          ac?: string | null
          antes?: Json
          aprovado_at?: string | null
          aprovado_nota?: string | null
          aprovado_por_id?: string | null
          aprovado_por_nome?: string | null
          autor_id?: string | null
          autor_nome?: string | null
          autor_observacao?: string | null
          company_id?: string
          conciliado_at?: string | null
          conciliado_nota?: string | null
          conciliado_por_id?: string | null
          conciliado_por_nome?: string | null
          created_at?: string
          depois?: Json
          id?: string
          related_case_id?: string | null
          reprovado_at?: string | null
          reprovado_motivo?: string | null
          reprovado_por_id?: string | null
          reprovado_por_nome?: string | null
          resumo: string
          status?: string
          student_id?: string | null
          student_name: string
          tipo: string
          updated_at?: string
        }
        Update: {
          ac?: string | null
          antes?: Json
          aprovado_at?: string | null
          aprovado_nota?: string | null
          aprovado_por_id?: string | null
          aprovado_por_nome?: string | null
          autor_id?: string | null
          autor_nome?: string | null
          autor_observacao?: string | null
          company_id?: string
          conciliado_at?: string | null
          conciliado_nota?: string | null
          conciliado_por_id?: string | null
          conciliado_por_nome?: string | null
          created_at?: string
          depois?: Json
          id?: string
          related_case_id?: string | null
          reprovado_at?: string | null
          reprovado_motivo?: string | null
          reprovado_por_id?: string | null
          reprovado_por_nome?: string | null
          resumo?: string
          status?: string
          student_id?: string | null
          student_name?: string
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conciliacao_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_snapshots: {
        Row: {
          company_id: string
          created_at: string
          id: string
          payload: Json
          snapshot_date: string
          student_count: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          payload: Json
          snapshot_date: string
          student_count?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          payload?: Json
          snapshot_date?: string
          student_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_snapshots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_rules: {
        Row: {
          company_id: string
          created_at: string
          desconto_renda_extra: number
          id: string
          juros_percent: number
          max_parcelas_cadastro: number
          max_parcelas_renegociacao: number
          meta_1: number
          meta_2: number
          meta_3: number
          meta_reversao_1: number | null
          meta_reversao_2: number | null
          meta_reversao_3: number | null
          multa_cancelamento_com_antecedencia: number
          multa_cancelamento_sem_antecedencia: number
          multa_percent: number
          updated_at: string
        }
        Insert: {
          company_id?: string
          created_at?: string
          desconto_renda_extra?: number
          id?: string
          juros_percent?: number
          max_parcelas_cadastro?: number
          max_parcelas_renegociacao?: number
          meta_1?: number
          meta_2?: number
          meta_3?: number
          meta_reversao_1?: number | null
          meta_reversao_2?: number | null
          meta_reversao_3?: number | null
          multa_cancelamento_com_antecedencia?: number
          multa_cancelamento_sem_antecedencia?: number
          multa_percent?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          desconto_renda_extra?: number
          id?: string
          juros_percent?: number
          max_parcelas_cadastro?: number
          max_parcelas_renegociacao?: number
          meta_1?: number
          meta_2?: number
          meta_3?: number
          meta_reversao_1?: number | null
          meta_reversao_2?: number | null
          meta_reversao_3?: number | null
          multa_cancelamento_com_antecedencia?: number
          multa_cancelamento_sem_antecedencia?: number
          multa_percent?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          ac_id: string | null
          body: string | null
          company_id: string
          created_at: string
          id: string
          meta: Json
          read_at: string | null
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          ac_id?: string | null
          body?: string | null
          company_id?: string
          created_at?: string
          id?: string
          meta?: Json
          read_at?: string | null
          title: string
          type: string
          user_id?: string | null
        }
        Update: {
          ac_id?: string | null
          body?: string | null
          company_id?: string
          created_at?: string
          id?: string
          meta?: Json
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          company_id: string
          created_at: string
          id: string
          name: string
          updated_at: string
          value: number | null
        }
        Insert: {
          company_id?: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          value?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      regua_mensagens: {
        Row: {
          ativo: boolean
          company_id: string
          created_at: string
          criterio: string
          dias: number
          id: string
          mensagem: string
          ordem: number
          status: string | null
          titulo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          company_id: string
          created_at?: string
          criterio?: string
          dias?: number
          id?: string
          mensagem?: string
          ordem?: number
          status?: string | null
          titulo: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          company_id?: string
          created_at?: string
          criterio?: string
          dias?: number
          id?: string
          mensagem?: string
          ordem?: number
          status?: string | null
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "regua_mensagens_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      student_tags: {
        Row: {
          color: string
          company_id: string
          created_at: string
          id: string
          name: string
          scope: string
          updated_at: string
        }
        Insert: {
          color?: string
          company_id?: string
          created_at?: string
          id?: string
          name: string
          scope?: string
          updated_at?: string
        }
        Update: {
          color?: string
          company_id?: string
          created_at?: string
          id?: string
          name?: string
          scope?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_tags_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          ac: string | null
          address: string | null
          cancellation_case_id: string | null
          cep: string | null
          ciclo: string | null
          cidade: string | null
          company_id: string
          cpf: string | null
          created_at: string
          data_treinamento_origem: string | null
          detalhes: string | null
          down_payment: number
          due_day: number
          email: string | null
          enrollment_date: string | null
          estado: string | null
          history: Json
          iam_control_aluno_id: number | null
          id: string
          installment_value: number
          installments: Json
          is_renda_extra: boolean
          name: string
          numero: string | null
          paid_installments: number
          product: string | null
          product_history: Json | null
          renda_extra_ac: string | null
          renda_extra_ac_assigned_at: string | null
          renda_extra_acordo_value: number | null
          renda_extra_directed_at: string | null
          renda_extra_inclusion_date: string | null
          renda_extra_inscription_date: string | null
          renda_extra_payment_date: string | null
          renda_extra_payment_method: string | null
          renda_extra_status: string | null
          renda_extra_value_at_direction: number | null
          sale_value: number
          status: string
          status_antes_cancelamento: string | null
          status_cancelamento: string | null
          status_mode: string
          tags: Json | null
          total_installments: number
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          ac?: string | null
          address?: string | null
          cancellation_case_id?: string | null
          cep?: string | null
          ciclo?: string | null
          cidade?: string | null
          company_id?: string
          cpf?: string | null
          created_at?: string
          data_treinamento_origem?: string | null
          detalhes?: string | null
          down_payment?: number
          due_day?: number
          email?: string | null
          enrollment_date?: string | null
          estado?: string | null
          history?: Json
          iam_control_aluno_id?: number | null
          id?: string
          installment_value?: number
          installments?: Json
          is_renda_extra?: boolean
          name: string
          numero?: string | null
          paid_installments?: number
          product?: string | null
          product_history?: Json | null
          renda_extra_ac?: string | null
          renda_extra_ac_assigned_at?: string | null
          renda_extra_acordo_value?: number | null
          renda_extra_directed_at?: string | null
          renda_extra_inclusion_date?: string | null
          renda_extra_inscription_date?: string | null
          renda_extra_payment_date?: string | null
          renda_extra_payment_method?: string | null
          renda_extra_status?: string | null
          renda_extra_value_at_direction?: number | null
          sale_value?: number
          status?: string
          status_antes_cancelamento?: string | null
          status_cancelamento?: string | null
          status_mode?: string
          tags?: Json | null
          total_installments?: number
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          ac?: string | null
          address?: string | null
          cancellation_case_id?: string | null
          cep?: string | null
          ciclo?: string | null
          cidade?: string | null
          company_id?: string
          cpf?: string | null
          created_at?: string
          data_treinamento_origem?: string | null
          detalhes?: string | null
          down_payment?: number
          due_day?: number
          email?: string | null
          enrollment_date?: string | null
          estado?: string | null
          history?: Json
          iam_control_aluno_id?: number | null
          id?: string
          installment_value?: number
          installments?: Json
          is_renda_extra?: boolean
          name?: string
          numero?: string | null
          paid_installments?: number
          product?: string | null
          product_history?: Json | null
          renda_extra_ac?: string | null
          renda_extra_ac_assigned_at?: string | null
          renda_extra_acordo_value?: number | null
          renda_extra_directed_at?: string | null
          renda_extra_inclusion_date?: string | null
          renda_extra_inscription_date?: string | null
          renda_extra_payment_date?: string | null
          renda_extra_payment_method?: string | null
          renda_extra_status?: string | null
          renda_extra_value_at_direction?: number | null
          sale_value?: number
          status?: string
          status_antes_cancelamento?: string | null
          status_cancelamento?: string | null
          status_mode?: string
          tags?: Json | null
          total_installments?: number
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "students_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      tutorials: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          title: string
          updated_at: string
          url: string
        }
        Insert: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          title: string
          updated_at?: string
          url: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          title?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      user_active_company: {
        Row: {
          company_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_active_company_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_companies: {
        Row: {
          company_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_companies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_company_acs: {
        Row: {
          ac_id: string
          company_id: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ac_id: string
          company_id: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ac_id?: string
          company_id?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_company_acs_ac_id_fkey"
            columns: ["ac_id"]
            isOneToOne: false
            referencedRelation: "acs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_company_acs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_ac_id: { Args: never; Returns: string }
      current_app_user_id: { Args: never; Returns: string }
      current_company_id: { Args: never; Returns: string }
      current_user_is_admin: { Args: never; Returns: boolean }
      has_admin_permission: { Args: { _user_id: string }; Returns: boolean }
      has_any_tab_edit: {
        Args: { _tabs: string[]; _user_id: string }
        Returns: boolean
      }
      has_any_tab_view: {
        Args: { _tabs: string[]; _user_id: string }
        Returns: boolean
      }
      has_company_access: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      has_conciliacao_access: { Args: { _user_id: string }; Returns: boolean }
      has_conciliacao_edit: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_tab_edit: {
        Args: { _tab: string; _user_id: string }
        Returns: boolean
      }
      has_tab_view: {
        Args: { _tab: string; _user_id: string }
        Returns: boolean
      }
      kamino_dashboard_forecast_totals: {
        Args: { p_ac?: string | null; p_product?: string | null }
        Returns: Json
      }
      mark_student_negativado: {
        Args: { _actor_name?: string; _student_id: string }
        Returns: {
          ac: string | null
          address: string | null
          cancellation_case_id: string | null
          cep: string | null
          ciclo: string | null
          cidade: string | null
          company_id: string
          cpf: string | null
          created_at: string
          data_treinamento_origem: string | null
          detalhes: string | null
          down_payment: number
          due_day: number
          email: string | null
          enrollment_date: string | null
          estado: string | null
          history: Json
          iam_control_aluno_id: number | null
          id: string
          installment_value: number
          installments: Json
          is_renda_extra: boolean
          name: string
          numero: string | null
          paid_installments: number
          product: string | null
          product_history: Json | null
          renda_extra_ac: string | null
          renda_extra_ac_assigned_at: string | null
          renda_extra_acordo_value: number | null
          renda_extra_directed_at: string | null
          renda_extra_inclusion_date: string | null
          renda_extra_inscription_date: string | null
          renda_extra_payment_date: string | null
          renda_extra_payment_method: string | null
          renda_extra_status: string | null
          renda_extra_value_at_direction: number | null
          sale_value: number
          status: string
          status_antes_cancelamento: string | null
          status_cancelamento: string | null
          status_mode: string
          tags: Json | null
          total_installments: number
          updated_at: string
          whatsapp: string | null
        }
        SetofOptions: {
          from: "*"
          to: "students"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role: "admin" | "ac" | "financeiro" | "conciliacao" | "juridico"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "ac", "financeiro", "conciliacao", "juridico"],
    },
  },
} as const

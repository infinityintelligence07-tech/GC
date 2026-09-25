import { describe, it, expect } from 'vitest';
import {
  getEffectivePermissions,
  canViewTab,
  canViewAllRegistros,
  type AppUser,
} from '@/types';

function user(over: Partial<AppUser> = {}): AppUser {
  return {
    id: 'u1',
    name: 'Elaine',
    login: 'elaine',
    role: 'ac',
    acId: 'ac-elaine',
    ...over,
  };
}

describe('getEffectivePermissions floors', () => {
  it('libera Alunos (view) para AC mesmo sem chave em permissions', () => {
    const perms = getEffectivePermissions(user({
      permissions: { equipe: 'edit', rendaExtra: 'edit' },
    }));
    expect(perms.alunos).toBe('view');
    expect(canViewTab(user({ permissions: { equipe: 'edit' } }), 'alunos')).toBe(true);
  });

  it('respeita alunos none explícito', () => {
    const perms = getEffectivePermissions(user({
      permissions: { alunos: 'none', equipe: 'edit' },
    }));
    expect(perms.alunos).toBe('none');
    expect(canViewTab(user({ permissions: { alunos: 'none' } }), 'alunos')).toBe(false);
  });

  it('AC vinculado recebe Registros own', () => {
    const u = user({ permissions: { equipe: 'edit' } });
    const perms = getEffectivePermissions(u);
    expect(perms.registros).toBe('own');
    expect(canViewTab(u, 'registros')).toBe(true);
    expect(canViewAllRegistros(u)).toBe(false);
  });

  it('admin vê todos os registros', () => {
    const u = user({ role: 'admin', acId: null, permissions: { admin: 'edit' } });
    expect(getEffectivePermissions(u).registros).toBe('edit');
    expect(canViewAllRegistros(u)).toBe(true);
  });

  it('usuário sem AC e sem chave registros não ganha a aba', () => {
    const u = user({
      role: 'juridico',
      acId: null,
      permissions: { cancelamentos: 'edit', documentos: 'edit' },
    });
    expect(getEffectivePermissions(u).registros).toBeUndefined();
    expect(canViewTab(u, 'registros')).toBe(false);
  });
});

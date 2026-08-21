import React, { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import type { User, Role } from "@platform/shared";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FieldGroup, Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import {
  UserPlus,
  KeyRound,
  Search,
  RefreshCw,
  MoreHorizontal,
  Edit2,
  Power,
  CheckCircle2,
  XCircle,
  Database,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { HeaderActions } from "@/context/HeaderActionsContext";

export const IAMUsersPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Modais de Criação / Edição e Reset
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  const [isResetOpen, setIsResetOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Form State Criação / Edição
  const [fullname, setFullname] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState("role_operador");
  const [externals, setExternals] = useState<Record<string, string | number>>({});
  const [submitting, setSubmitting] = useState(false);

  // Form State Reset Senha
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [usersRes, rolesRes] = await Promise.all([
        api.iam.listUsers(),
        api.iam.listRoles(),
      ]);
      setUsers(usersRes);
      setRoles(rolesRes);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao carregar usuários";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const availableSources = Array.from(
    new Set([
      "inovafarma",
      "sap",
      ...users.flatMap((u) => Object.keys(u.externals || {})),
      ...Object.keys(externals),
    ])
  );

  const openCreateModal = () => {
    setIsEditMode(false);
    setEditingUserId(null);
    setFullname("");
    setUsername("");
    setEmail("");
    setPassword("");
    setRoleId(roles[0]?.id || "role_operador");
    setExternals({});
    setIsModalOpen(true);
  };

  const openEditModal = (u: User) => {
    setIsEditMode(true);
    setEditingUserId(u.id);
    setFullname(u.fullname);
    setUsername(u.username);
    setEmail(u.email || "");
    setPassword("");
    setRoleId(u.roleId);
    setExternals(u.externals || {});
    setIsModalOpen(true);
  };

  const handleExternalChange = (source: string, val: string) => {
    setExternals((prev) => {
      const next = { ...prev };
      if (!val || val.trim() === "") {
        delete next[source];
      } else {
        const num = Number(val.trim());
        next[source] = isNaN(num) ? val.trim() : num;
      }
      return next;
    });
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);

      if (isEditMode && editingUserId) {
        await api.iam.updateUser(editingUserId, {
          fullname: fullname.trim(),
          email: email.trim(),
          roleId,
          externals,
        });
        toast.success("Usuário atualizado com sucesso!");
      } else {
        await api.iam.createUser({
          fullname: fullname.trim(),
          username: username.trim(),
          email: email.trim(),
          password,
          roleId,
          externals,
        });
        toast.success("Usuário cadastrado com sucesso!");
      }

      setIsModalOpen(false);
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Falha ao salvar usuário";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    try {
      setResetting(true);
      await api.iam.resetPassword(selectedUser.id, newPassword);
      toast.success(`Senha de ${selectedUser.username} redefinida com sucesso!`);
      setIsResetOpen(false);
      setNewPassword("");
      setSelectedUser(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Falha ao redefinir senha";
      toast.error(msg);
    } finally {
      setResetting(false);
    }
  };

  const handleToggleStatus = async (user: User) => {
    try {
      const nextStatus = user.status === "active" ? "inactive" : "active";
      await api.iam.updateUser(user.id, { status: nextStatus });
      toast.success(`Usuário ${user.username} ${nextStatus === "active" ? "ativado" : "desativado"}.`);
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao alterar status";
      toast.error(msg);
    }
  };

  const getRoleName = (roleId: string) => {
    const r = roles.find((role) => role.id === roleId);
    return r ? r.name : roleId;
  };

  const filteredUsers = users.filter((u) => {
    const q = search.toLowerCase();
    return (
      u.fullname.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      (u.email && u.email.toLowerCase().includes(q))
    );
  });

  return (
    <div className="flex flex-col gap-6">
      <HeaderActions>
        <Button variant="outline" onClick={fetchData} disabled={loading}>
          <RefreshCw className={`size-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>

        {hasPermission("system:users:create") && (
          <Button onClick={openCreateModal}>
            <UserPlus className="size-3.5 mr-1.5" />
            Novo Usuário
          </Button>
        )}
      </HeaderActions>

      {/* Top Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Gestão de Usuários</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Controle de acessos, grupos e identidades de autenticação.
        </p>
      </div>

      {/* Tabela de Usuários */}
      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <CardTitle className="text-base font-semibold">
            Usuários Cadastrados ({filteredUsers.length})
          </CardTitle>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar por nome, usuário ou e-mail..."
              className="pl-8 w-72"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Nome Completo</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right w-20">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, idx) => (
                  <TableRow key={idx}>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                    Nenhum usuário encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map((u) => (
                  <TableRow key={u.id} className="hover:bg-muted/30">
                    <TableCell className="font-medium">{u.fullname}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{u.username}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{u.email || "-"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{getRoleName(u.roleId)}</Badge>
                    </TableCell>
                    <TableCell>
                      {u.status === "active" ? (
                        <Badge variant="outline" className="text-emerald-600 border-emerald-300 flex items-center gap-1 w-fit">
                          <CheckCircle2 className="size-3" />
                          Ativo
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground flex items-center gap-1 w-fit">
                          <XCircle className="size-3" />
                          Inativo
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {hasPermission("system:users:update") && (
                            <DropdownMenuItem onClick={() => openEditModal(u)} className="cursor-pointer">
                              <Edit2 className="size-4 mr-2" />
                              Editar Usuário
                            </DropdownMenuItem>
                          )}
                          {hasPermission("system:users:reset_password") && (
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedUser(u);
                                setIsResetOpen(true);
                              }}
                              className="cursor-pointer"
                            >
                              <KeyRound className="size-4 mr-2" />
                              Redefinir Senha
                            </DropdownMenuItem>
                          )}
                          {hasPermission("system:users:update") && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleToggleStatus(u)}
                                className={`cursor-pointer ${u.status === "active" ? "text-destructive" : "text-emerald-600"}`}
                              >
                                <Power className="size-4 mr-2" />
                                {u.status === "active" ? "Desativar Usuário" : "Ativar Usuário"}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Modal de Criação / Edição */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSaveUser}>
            <DialogHeader>
              <DialogTitle>{isEditMode ? "Editar Usuário" : "Cadastrar Novo Usuário"}</DialogTitle>
              <DialogDescription>
                {isEditMode
                  ? "Atualize os dados, perfil e identificadores ERP do usuário."
                  : "Crie uma nova identidade no sistema com perfil e senha inicial."}
              </DialogDescription>
            </DialogHeader>

            <FieldGroup className="py-4">
              <Field>
                <FieldLabel htmlFor="u-fullname">Nome Completo</FieldLabel>
                <Input
                  id="u-fullname"
                  placeholder="Ex: Carlos Silva"
                  value={fullname}
                  onChange={(e) => setFullname(e.target.value)}
                  required
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="u-username">Nome de Usuário</FieldLabel>
                  <Input
                    id="u-username"
                    placeholder="carlos.silva"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isEditMode}
                    required
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="u-email">E-mail</FieldLabel>
                  <Input
                    id="u-email"
                    type="email"
                    placeholder="carlos@empresa.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="u-role">Perfil de Acesso</FieldLabel>
                <Select value={roleId} onValueChange={(val: string | null) => val && setRoleId(val)}>
                  <SelectTrigger id="u-role" className="w-full">
                    <SelectValue placeholder="Selecione o perfil">
                      {roleId ? getRoleName(roleId) : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {/* Seção 100% shadcn para Identificadores ERP (Fontes Oficiais) */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Database className="size-3.5 text-primary" />
                    Identificadores nos ERPs (Fontes de Dados)
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Mapeamento das chaves de identificação do usuário em cada fonte oficial.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {availableSources.map((src) => (
                    <div
                      key={src}
                      className="flex items-center justify-between gap-4 p-2.5 border bg-muted/20 hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Database className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="font-mono text-xs font-semibold text-foreground">{src}</span>
                      </div>
                      <div className="flex items-center gap-2 w-44">
                        <Input
                          placeholder="Não vinculado"
                          className="h-8 font-mono text-xs text-right"
                          value={externals[src] !== undefined ? String(externals[src]) : ""}
                          onChange={(e) => handleExternalChange(src, e.target.value)}
                        />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {!isEditMode && (
                <Field>
                  <FieldLabel htmlFor="u-password">Senha Inicial</FieldLabel>
                  <Input
                    id="u-password"
                    type="password"
                    placeholder="Mínimo 8 caracteres (Aa1@)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <span className="text-[11px] text-muted-foreground mt-1">
                    Requer: 1 maiúscula, 1 minúscula, 1 número e 1 especial.
                  </span>
                </Field>
              )}
            </FieldGroup>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Salvando..." : isEditMode ? "Salvar Alterações" : "Cadastrar Usuário"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal de Redefinição de Senha */}
      <Dialog open={isResetOpen} onOpenChange={setIsResetOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleResetPassword}>
            <DialogHeader>
              <DialogTitle>Redefinir Senha</DialogTitle>
              <DialogDescription>
                Defina uma nova senha para <strong>{selectedUser?.fullname}</strong> ({selectedUser?.username}).
              </DialogDescription>
            </DialogHeader>

            <FieldGroup className="py-4">
              <Field>
                <FieldLabel htmlFor="r-pass">Nova Senha</FieldLabel>
                <Input
                  id="r-pass"
                  type="password"
                  placeholder="Mínimo 8 caracteres (Aa1@)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
                <span className="text-[11px] text-muted-foreground mt-1">
                  Requer 1 maiúscula, 1 minúscula, 1 número e 1 especial.
                </span>
              </Field>
            </FieldGroup>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setIsResetOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={resetting}>
                {resetting ? "Salvando..." : "Salvar Senha"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

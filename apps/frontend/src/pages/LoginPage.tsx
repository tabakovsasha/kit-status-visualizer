import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { authApi } from "../lib/api";
import { useAuthStore } from "../state/auth";
import { useNavigate } from "react-router-dom";

const schema = z.object({
  login: z.string().min(1, "Введите логин"),
  password: z.string().min(8, "Минимум 8 символов"),
});

type FormData = z.infer<typeof schema>;

export function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { login: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const result = await authApi.login(values);
      setAuth(result);
      navigate("/connection");
    } catch {
      setError("root", {
        message: "Не удалось выполнить вход. Проверьте логин и пароль.",
      });
    }
  });

  return (
    <section className="card login-card">
      <h1>Вход</h1>
      <p>Введите учетные данные локального пользователя сервиса.</p>
      <form onSubmit={onSubmit} className="form-grid">
        <label>
          Логин
          <input {...register("login")} autoComplete="username" />
          {errors.login && (
            <small className="error">{errors.login.message}</small>
          )}
        </label>
        <label>
          Пароль
          <input
            type="password"
            {...register("password")}
            autoComplete="current-password"
          />
          {errors.password && (
            <small className="error">{errors.password.message}</small>
          )}
        </label>
        {errors.root && <div className="error-box">{errors.root.message}</div>}
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Выполняется вход..." : "Войти"}
        </button>
      </form>
    </section>
  );
}

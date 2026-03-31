import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Enter your email").email("Invalid email"),
  password: z.string().min(1, "Enter your password"),
});

export const registerSchema = z
  .object({
    email: z.string().trim().min(1, "Enter your email").email("Invalid email"),
    password: z
      .string()
      .min(6, "Password must be at least 6 characters")
      .max(72, "Password is too long"),
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type LoginFormValues = z.infer<typeof loginSchema>;
export type RegisterFormValues = z.infer<typeof registerSchema>;

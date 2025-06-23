export class LoginRequest {
  user: string;
  password: string;

  constructor(user: string, password: string) {
    this.user = user;
    this.password = password;
  }
}
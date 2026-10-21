console.error(`SG Farma: este frontend de producción se ejecuta con Nginx.
En Coolify selecciona Build strategy= Dockerfile, rama deploy, puerto interno 80,
archivo /Dockerfile y deja vacío el comando de inicio personalizado.
Configura API_UPSTREAM con la URL interna del backend Spring Boot.
Para desarrollo local usa: npm run dev.
No se iniciará ng serve como servidor de producción.`);
process.exitCode = 1;

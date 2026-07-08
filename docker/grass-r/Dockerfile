FROM --platform=linux/amd64 rocker/geospatial:4.4.1

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
        grass grass-dev \
        python3-venv curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Google Cloud SDK (gsutil, gcloud) — instalado vía script oficial en vez de
# apt, para no depender de registrar el repo apt.googleapis.com.
RUN curl -sSL https://sdk.cloud.google.com | bash -s -- --disable-prompts --install-dir=/opt
ENV PATH="/opt/google-cloud-sdk/bin:${PATH}"

# earthengine-api en un venv propio: da el módulo Python `ee` (lo usa rgee
# via reticulate) y el comando `earthengine` CLI (lo usa 03B_uploadToGEE.R
# directamente). RETICULATE_PYTHON apunta reticulate a este mismo venv para
# que no intente bootstrapear su propio miniconda.
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir earthengine-api
ENV PATH="/opt/venv/bin:${PATH}"
ENV RETICULATE_PYTHON=/opt/venv/bin/python3

# La imagen base geospatial ya trae: sf, terra, raster, leaflet, leafem, s2,
# units — todas las dependencias pesadas de rgee. Sólo se instalan los paquetes
# que no vienen en la base.
RUN R -e "\
    pkgs <- c('rgrass', 'googleCloudStorageR', 'gargle', 'rgee', 'jsonlite'); \
    install.packages(pkgs, repos = 'https://cloud.r-project.org'); \
    missing <- setdiff(pkgs, rownames(installed.packages())); \
    if (length(missing) > 0) stop('Fallaron al instalar: ', paste(missing, collapse = ', '))"

WORKDIR /work

# En modo RStudio (--entrypoint /init) la sesión de R arranca en el home del
# usuario rstudio, no en /home/rstudio/work (donde queda montado el volumen)
# — sin esto había que correr setwd("~/work") a mano en cada sesión nueva.
# Rprofile.site corre en TODA sesión de R (RStudio y Rscript por igual); el
# dir.exists() lo vuelve inofensivo en el modo entrypoint.sh normal, donde
# ese path no existe.
RUN echo 'if (dir.exists("/home/rstudio/work")) setwd("/home/rstudio/work")' \
    >> /usr/local/lib/R/etc/Rprofile.site

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]

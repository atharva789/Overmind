FROM ghcr.io/berriai/litellm:main-latest

# Set the working directory
WORKDIR /app

# Expose the default LiteLLM proxy port
EXPOSE 4000

# If you have a config file, you would copy it here
# COPY config.yaml /app/config.yaml
# CMD ["--config", "/app/config.yaml", "--port", "4000"]

# Ensure we have our port strictly defined. The official image entrypoint handles the rest.
CMD ["--port", "4000"]

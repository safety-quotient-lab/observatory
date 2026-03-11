// Observatory — Tier 2 CI/CD Pipeline
//
// CONTEXT
// Observatory hosts the hn-hrcb site (CF Pages) and cron worker (CF Worker).
// Tier 1 (GitHub Actions deploy.yml) handles Cloudflare deploys directly.
// This Jenkins pipeline adds build validation and provides a fallback
// deploy path through forge.safety-quotient.dev.
//
// The observatory also runs meshd on chromabook (:8079) — but meshd is
// built and deployed from the psychology-agent repo's Jenkinsfile, not here.
// This pipeline covers only observatory-specific artifacts.
//
// BUILD TRIGGER
// Builds trigger via a GitHub Actions relay (.github/workflows/trigger-forge.yml).
// See that file for why a relay is needed (Cloudflare Access authentication).
// SCM polling serves as a fallback.
//
// Required credentials (Jenkins > Manage > Credentials):
//   'cloudflare-workers-token'  — CF API token (Secret text)
//   'cloudflare-account-id'     — CF account ID (Secret text)

pipeline {
    agent any

    environment {
        CLOUDFLARE_API_TOKEN  = credentials('cloudflare-workers-token')
        CLOUDFLARE_ACCOUNT_ID = credentials('cloudflare-account-id')
    }

    stages {
        // Build the observatory site and verify output.
        stage('Build Site') {
            when {
                branch 'main'
                changeset 'site/**'
            }
            steps {
                dir('site') {
                    sh 'npm ci && npm run build'
                    sh '''
                        COUNT=$(find dist -name "*.html" | wc -l)
                        echo "Pages built: $COUNT"
                        if [ "$COUNT" -lt 1 ]; then
                            echo "ERROR: No HTML pages generated"
                            exit 1
                        fi
                    '''
                }
            }
        }

        // Deploy site to Cloudflare Pages (fallback for Tier 1).
        stage('Deploy Site') {
            when {
                branch 'main'
                changeset 'site/**'
            }
            steps {
                dir('site') {
                    sh 'npx wrangler pages deploy dist --project-name=hn-hrcb'
                }
            }
        }

        // Deploy cron worker to Cloudflare (fallback for Tier 1).
        stage('Deploy Cron Worker') {
            when {
                branch 'main'
                changeset 'worker/**'
            }
            steps {
                dir('worker') {
                    sh 'npx wrangler deploy'
                }
            }
        }
    }

    post {
        success {
            echo "Build succeeded: ${env.BUILD_URL}"
        }
        failure {
            echo "Build failed: ${env.BUILD_URL}"
        }
    }
}

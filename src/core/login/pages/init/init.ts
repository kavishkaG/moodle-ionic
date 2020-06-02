// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Component, ViewChild, ElementRef } from '@angular/core';
import { IonicPage, NavController } from 'ionic-angular';
import { SplashScreen } from '@ionic-native/splash-screen';
import { CoreAppProvider } from '@providers/app';
import { CoreInitDelegate } from '@providers/init';
import { CoreSitesProvider, CoreSiteCheckResponse } from '@providers/sites';
import { CoreConstants } from '../../../constants';
import { CoreLoginHelperProvider } from '../../providers/helper';
import { CoreDomUtilsProvider } from '@providers/utils/dom';
import { TranslateService } from '@ngx-translate/core';
import { CoreUrl } from '@classes/utils/url';
import { CoreUrlUtilsProvider } from '@providers/utils/url';

/**
 * Data about an error when connecting to a site.
 */
type CoreLoginSiteError = {
    /**
     * The error message that ocurred.
     */
    message: string;

    /**
     * URL the user entered.
     */
    url?: string;

    /**
     * URL the user entered with protocol added if needed.
     */
    fullUrl?: string;
};

/**
 * Page that displays a "splash screen" while the app is being initialized.
 */
@IonicPage({ segment: 'core-login-init' })
@Component({
    selector: 'page-core-login-init',
    templateUrl: 'init.html',
})
export class CoreLoginInitPage {

    @ViewChild('siteFormEl') formElement: ElementRef;
    error: CoreLoginSiteError;

    constructor(private navCtrl: NavController, private appProvider: CoreAppProvider, private initDelegate: CoreInitDelegate,
        private sitesProvider: CoreSitesProvider, private loginHelper: CoreLoginHelperProvider,
        private splashScreen: SplashScreen, protected domUtils: CoreDomUtilsProvider, protected translate: TranslateService,
        protected urlUtils: CoreUrlUtilsProvider) { }
    /**
     * View loaded.
     */
    ionViewDidLoad(): void {
        // Wait for the app to be ready.
        this.initDelegate.ready().then(() => {
            // Check if there was a pending redirect.
            const redirectData = this.appProvider.getRedirect();
            if (redirectData.siteId) {
                // Unset redirect data.
                this.appProvider.storeRedirect('', '', '');

                // Only accept the redirect if it was stored less than 20 seconds ago.
                if (Date.now() - redirectData.timemodified < 20000) {
                    if (redirectData.siteId != CoreConstants.NO_SITE_ID) {
                        // The redirect is pointing to a site, load it.
                        return this.sitesProvider.loadSite(redirectData.siteId, redirectData.page, redirectData.params)
                                .then((loggedIn) => {

                            if (loggedIn) {
                                return this.loginHelper.goToSiteInitialPage(this.navCtrl, redirectData.page, redirectData.params,
                                        { animate: false });
                            }
                        }).catch(() => {
                            // Site doesn't exist.
                            return this.connect('https://samanaladanuma.lk/moodle30/');
                        });
                    } else {
                        // No site to load, open the page.
                        return this.loginHelper.goToNoSitePage(this.navCtrl, redirectData.page, redirectData.params);
                    }
                }
            }

            return this.loadPage();
        }).then(() => {
            // If we hide the splash screen now, the init view is still seen for an instant. Wait a bit to make sure it isn't seen.
            setTimeout(() => {
                this.splashScreen.hide();
            }, 100);
        });
    }

    /**
     * Load the right page.
     *
     * @return Promise resolved when done.
     */
    protected loadPage(): Promise<any> {
        if (this.sitesProvider.isLoggedIn()) {
            if (this.loginHelper.isSiteLoggedOut()) {
                return this.sitesProvider.logout().then(() => {
                    return this.loadPage();
                });
            }

            return this.loginHelper.goToSiteInitialPage();
        }

        return this.navCtrl.setRoot('CoreLoginCredentialsPage');
    }

    /**
     * Try to connect to a site.
     *
     * @param url The URL to connect to.
     */
   connect(url: string): void {

       this.appProvider.closeKeyboard();

       if (!url) {
           this.domUtils.showErrorModal('core.login.siteurlrequired', true);

           return;
       }

       if (!this.appProvider.isOnline()) {
           this.domUtils.showErrorModal('core.networkerrormsg', true);

           return;
       }

       url = url.trim();

       if (url.match(/^(https?:\/\/)?campus\.example\.edu/)) {
           this.showLoginIssue(null, this.translate.instant('core.login.errorexampleurl'));

           return;
       }

       this.hideLoginIssue();

       const modal = this.domUtils.showModalLoading(),
           siteData = this.sitesProvider.getDemoSiteData(url);

       if (siteData.username) {
           // It's a demo site.
           this.sitesProvider.getUserToken(siteData.url, siteData.username, siteData.password).then((data) => {
               return this.sitesProvider.newSite(data.siteUrl, data.token, data.privateToken).then(() => {

                   this.domUtils.triggerFormSubmittedEvent(this.formElement, true);

                   return this.loginHelper.goToSiteInitialPage();
               }, (error) => {
                   this.loginHelper.treatUserTokenError(siteData.url, error, siteData.username, siteData.password);
                   if (error.loggedout) {
                       this.navCtrl.setRoot('CoreLoginCredentialsPage');
                   }
               });
           }, (error) => {
               this.loginHelper.treatUserTokenError(siteData.url, error, siteData.username, siteData.password);
               if (error.loggedout) {
                   this.navCtrl.setRoot('CoreLoginCredentialsPage');
               }
           }).finally(() => {
               modal.dismiss();
           });

       } else {
           // Not a demo site.
           this.sitesProvider.checkSite(url)
               .catch((error) => {
                   // Attempt guessing the domain if the initial check failed
                   const domain = CoreUrl.guessMoodleDomain(url);

                   return domain ? this.sitesProvider.checkSite(domain) : Promise.reject(error);
               })
               .then((result) => this.login(result))
               .catch((error) => this.showLoginIssue(url, error))
               .finally(() => modal.dismiss());
       }
   }

    protected hideLoginIssue(): void {
        this.error = null;
    }

    protected showLoginIssue(url: string, error: any): void {
        this.error = {
            url: url,
            message: this.domUtils.getErrorMessage(error),
        };

        if (url) {
            this.error.fullUrl = this.urlUtils.isAbsoluteURL(url) ? url : 'https://' + url;
        }
    }

    protected async login(response: CoreSiteCheckResponse): Promise<void> {
        return this.sitesProvider.checkRequiredMinimumVersion(response.config).then(() => {

            this.domUtils.triggerFormSubmittedEvent(this.formElement, true);

            if (response.warning) {
                this.domUtils.showErrorModal(response.warning, true, 4000);
            }

            if (this.loginHelper.isSSOLoginNeeded(response.code)) {
                // SSO. User needs to authenticate in a browser.
                this.loginHelper.confirmAndOpenBrowserForSSOLogin(
                    response.siteUrl, response.code, response.service, response.config && response.config.launchurl);
            } else {
                this.navCtrl.push('CoreLoginCredentialsPage', { siteUrl: response.siteUrl, siteConfig: response.config });
            }
        }).catch(() => {
            // Ignore errors.
        });
    }

}
